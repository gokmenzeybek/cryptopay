#!/usr/bin/env node
/**
 * CryptoPay API Server with PostgreSQL Database
 * Full-featured XRPL payment application with persistent storage
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// Import services
const tryRateScraperService = require('./services/tryRateScraperService');
const p2pMatchingService = require('./services/p2pMatchingService');
const { initWebSocketServer, broadcastOrderUpdate } = require('./services/websocketService');
const { createRateLimiter } = require('./middleware/rateLimit');

// Import database modules
const { pool, testConnection, healthCheck } = require('./database/connection');
const { WalletsDAL, TransactionsDAL, PaymentRequestsDAL, P2POrdersDAL } = require('./database/dal');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = 5001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'build')));

// Database connection check
let dbConnected = false;

// Configuration

// Routes

// Root - API documentation
app.get('/api', (req, res) => {
    res.json({
        message: 'CryptoPay P2P TRY-XRP Exchange API',
        version: '3.0.0',
        description: 'Peer-to-peer TRY to XRP conversion without third-party payment providers',
        endpoints: {
            wallets: '/api/wallets',
            transactions: '/api/transactions',
            payment_requests: '/api/payment_requests',
            p2p_rate: '/api/p2p/rate',
            p2p_create_order: '/api/p2p/create-order',
            p2p_orders: '/api/p2p/orders',
            p2p_my_orders: '/api/p2p/my-orders/:address',
            p2p_match: '/api/p2p/match',
            p2p_confirm_payment: '/api/p2p/confirm-payment',
            p2p_confirm_xrp: '/api/p2p/confirm-xrp',
            p2p_cancel: '/api/p2p/cancel',
            p2p_dispute: '/api/p2p/dispute',
            p2p_stats: '/api/p2p/stats',
            p2p_payment_methods: '/api/p2p/payment-methods',
            // Papara integration endpoints
            p2p_validate_papara: '/api/p2p/validate-papara-account',
            p2p_initiate_papara: '/api/p2p/initiate-papara-payment',
            p2p_papara_status: '/api/p2p/papara-payment-status/:orderId',
            p2p_papara_balance: '/api/p2p/papara-balance',
            stats: '/api/stats',
            health: '/api/health'
        },
        dashboard: '/shared_dashboard.html'
    });
});

// ========================================================================
// P2P TRY-XRP CONVERSION API ENDPOINTS
// ========================================================================

// Get current XRP/TRY rate from scraped sources
app.get('/api/p2p/rate', createRateLimiter('exchange-rates'), async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === 'true';
        // Get current orders from database for rate calculation
        const currentOrders = await P2POrdersDAL.getAll(100);
        const rateData = await tryRateScraperService.getCurrentRate(forceRefresh, currentOrders);

        res.json({
            success: true,
            currency: 'TRY',
            ...rateData,
            marketStats: tryRateScraperService.getMarketStats(rateData)
        });
    } catch (error) {
        console.error('Error fetching TRY rate:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch XRP/TRY rate',
            message: error.message
        });
    }
});

// Create P2P order (buy or sell)
app.post('/api/p2p/create-order', createRateLimiter('payment-intent'), async (req, res) => {
    try {
        const {
            type,           // 'buy' or 'sell'
            tryAmount,
            xrpAmount,
            rate,
            xrplAddress,
            paymentMethods,
            minAmount,
            maxAmount,
            timeLimit,
            metadata
        } = req.body;

        // Validate inputs
        if (!type || !tryAmount || !xrpAmount || !rate || !xrplAddress || !paymentMethods) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['type', 'tryAmount', 'xrpAmount', 'rate', 'xrplAddress', 'paymentMethods']
            });
        }

        // Validate XRPL address format
        const address = xrplAddress.trim();
        if (address.length < 25 || address.length > 34) {
            return res.status(400).json({
                success: false,
                error: 'Invalid XRPL address',
                message: `XRPL address must be 25-34 characters long (current: ${address.length})`
            });
        }
        if (!address.startsWith('r')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid XRPL address',
                message: 'XRPL address must start with "r"'
            });
        }
        
        // Basic XRPL address validation (length and prefix)
        // Note: Full Base58 validation is complex, so we'll rely on length and prefix

        // Validate order type
        if (type !== p2pMatchingService.ORDER_TYPE.BUY && type !== p2pMatchingService.ORDER_TYPE.SELL) {
            return res.status(400).json({
                success: false,
                error: 'Invalid order type',
                message: 'Type must be "buy" or "sell"'
            });
        }

        // Create P2P order
        const order = p2pMatchingService.createP2POrder({
            type,
            tryAmount,
            xrpAmount,
            rate,
            xrplAddress,
            paymentMethods,
            minAmount,
            maxAmount,
            timeLimit,
            metadata
        });

        // Store order in database
        const dbOrder = await P2POrdersDAL.create({
            order_id: order.id,
            xrpl_address: order.xrplAddress,
            order_type: order.type,
            amount_xrp: order.xrpAmount,
            amount_try: order.tryAmount,
            rate: order.rate,
            payment_methods: order.paymentMethods,
            expires_at: new Date(order.expiresAt),
            metadata: order.metadata ? JSON.stringify(order.metadata) : null
        });

        // Get all open orders for matching
        const allOrders = await P2POrdersDAL.getOpenOrders(order.type === 'buy' ? 'sell' : 'buy', 100);
        const ordersForMatching = allOrders.map(o => ({
            id: o.order_id,
            type: o.order_type,
            xrpAmount: parseFloat(o.amount_xrp),
            tryAmount: parseFloat(o.amount_try),
            rate: parseFloat(o.rate),
            xrplAddress: o.xrpl_address,
            paymentMethods: o.payment_methods,
            createdAt: o.created_at,
            expiresAt: o.expires_at
        }));

        // Find potential matches
        const matches = p2pMatchingService.findMatchingOrders(order, ordersForMatching);

        res.json({
            success: true,
            message: 'P2P order created successfully',
            order: p2pMatchingService.getOrderSummary(order),
            potentialMatches: matches.slice(0, 5).map(m => p2pMatchingService.getOrderSummary(m))
        });
    } catch (error) {
        console.error('Error creating P2P order:', error);
        res.status(400).json({
            success: false,
            error: 'Failed to create P2P order',
            message: error.message
        });
    }
});

// Get all open P2P orders
app.get('/api/p2p/orders', async (req, res) => {
    try {
        const { type, status, limit = 50 } = req.query;

        // Clean up expired orders in database
        await P2POrdersDAL.cleanupExpired();

        // Get orders from database
        let orders;
        if (type && status) {
            orders = await P2POrdersDAL.getByTypeAndStatus(type, status, parseInt(limit));
        } else if (type) {
            orders = await P2POrdersDAL.getOpenOrders(type, parseInt(limit));
        } else if (status) {
            orders = await P2POrdersDAL.getAll(parseInt(limit));
            orders = orders.filter(o => o.status === status);
        } else {
            // Default to showing only open orders
            orders = await P2POrdersDAL.getOpenOrders('buy', parseInt(limit));
            const sellOrders = await P2POrdersDAL.getOpenOrders('sell', parseInt(limit));
            orders = [...orders, ...sellOrders];
        }

        // Convert to the format expected by the frontend
        const formattedOrders = orders.map(o => ({
            id: o.order_id,
            type: o.order_type,
            xrpAmount: parseFloat(o.amount_xrp),
            tryAmount: parseFloat(o.amount_try),
            rate: parseFloat(o.rate),
            xrplAddress: o.xrpl_address,
            paymentMethods: o.payment_methods,
            status: o.status,
            createdAt: o.created_at,
            expiresAt: o.expires_at,
            counterpartyOrderId: o.counterparty_order_id,
            counterpartyAddress: o.counterparty_address,
            paymentReference: o.payment_reference,
            xrpTransactionHash: o.xrp_transaction_hash,
            matchedAt: o.matched_at,
            paymentConfirmedAt: o.payment_confirmed_at,
            completedAt: o.completed_at,
            disputeReason: o.dispute_reason,
            metadata: o.metadata || null
        }));

        res.json({
            success: true,
            count: formattedOrders.length,
            orders: formattedOrders.map(o => p2pMatchingService.getOrderSummary(o))
        });
    } catch (error) {
        console.error('Error fetching P2P orders:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch P2P orders',
            message: error.message
        });
    }
});

// Get user's orders by XRPL address
app.get('/api/p2p/my-orders/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const { status, limit = 50 } = req.query;

        // Clean up expired orders in database
        await P2POrdersDAL.cleanupExpired();

        // Get user orders from database
        let userOrders = await P2POrdersDAL.getByAddress(address, parseInt(limit));

        if (status) {
            userOrders = userOrders.filter(o => o.status === status);
        }

        // Convert to the format expected by the frontend
        const formattedOrders = userOrders.map(o => ({
            id: o.order_id,
            type: o.order_type,
            xrpAmount: parseFloat(o.amount_xrp),
            tryAmount: parseFloat(o.amount_try),
            rate: parseFloat(o.rate),
            xrplAddress: o.xrpl_address,
            paymentMethods: o.payment_methods,
            status: o.status,
            createdAt: o.created_at,
            expiresAt: o.expires_at,
            counterpartyOrderId: o.counterparty_order_id,
            counterpartyAddress: o.counterparty_address,
            paymentReference: o.payment_reference,
            xrpTransactionHash: o.xrp_transaction_hash,
            matchedAt: o.matched_at,
            paymentConfirmedAt: o.payment_confirmed_at,
            completedAt: o.completed_at,
            disputeReason: o.dispute_reason,
            metadata: o.metadata || null
        }));

        res.json({
            success: true,
            address: address,
            count: formattedOrders.length,
            orders: formattedOrders.map(o => p2pMatchingService.getOrderSummary(o))
        });
    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user orders',
            message: error.message
        });
    }
});

// Match with an existing order
app.post('/api/p2p/match', createRateLimiter('payment-intent'), async (req, res) => {
    try {
        const { orderId, counterpartyOrderId } = req.body;

        if (!orderId || !counterpartyOrderId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['orderId', 'counterpartyOrderId']
            });
        }

        const order = await P2POrdersDAL.getByOrderId(orderId);
        const counterpartyOrder = await P2POrdersDAL.getByOrderId(counterpartyOrderId);

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        if (!counterpartyOrder) {
            return res.status(404).json({
                success: false,
                error: 'Counterparty order not found'
            });
        }

        // Match the orders using database
        const matchResult = await P2POrdersDAL.matchOrders(orderId, counterpartyOrderId);

        res.json({
            success: true,
            message: 'Orders matched successfully',
            match: {
                buy_order: matchResult.buy_order,
                sell_order: matchResult.sell_order,
                match: matchResult.match
            },
            nextStep: 'Buyer should now transfer TRY via the agreed payment method, then call /api/p2p/confirm-payment'
        });
    } catch (error) {
        console.error('Error matching orders:', error);
        res.status(400).json({
            success: false,
            error: 'Failed to match orders',
            message: error.message
        });
    }
});

// Confirm TRY payment
app.post('/api/p2p/confirm-payment', createRateLimiter('conversion'), async (req, res) => {
    try {
        const { orderId, proofOfPayment } = req.body;

        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: 'Missing orderId'
            });
        }

        const order = await P2POrdersDAL.getByOrderId(orderId);

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        // Confirm payment
        p2pMatchingService.confirmPayment(order, proofOfPayment);
        
        // Update the order in the database
        await P2POrdersDAL.updateOrderStatus(order.order_id, 'payment_confirmed', {
            payment_confirmed_at: new Date().toISOString(),
            payment_reference: proofOfPayment
        });
        
        // Also update the counterparty order if it exists
        if (order.counterparty_order_id) {
            await P2POrdersDAL.updateOrderStatus(order.counterparty_order_id, 'payment_confirmed', {
                payment_confirmed_at: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            message: 'TRY payment confirmed',
            order: p2pMatchingService.getOrderSummary(order),
            nextStep: 'Seller should now transfer XRP and call /api/p2p/confirm-xrp with the transaction hash'
        });
    } catch (error) {
        console.error('Error confirming payment:', error);
        res.status(400).json({
            success: false,
            error: 'Failed to confirm payment',
            message: error.message
        });
    }
});

// Confirm XRP transfer
app.post('/api/p2p/confirm-xrp', createRateLimiter('conversion'), async (req, res) => {
    try {
        const { orderId, xrpTransactionHash } = req.body;

        if (!orderId || !xrpTransactionHash) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['orderId', 'xrpTransactionHash']
            });
        }

        const order = await P2POrdersDAL.getByOrderId(orderId);

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        // Confirm XRP transfer
        p2pMatchingService.confirmXrpTransfer(order, xrpTransactionHash);
        
        // Update the order in the database
        await P2POrdersDAL.updateOrderStatus(order.order_id, 'completed', {
            xrp_transaction_hash: xrpTransactionHash,
            completed_at: new Date().toISOString()
        });
        
        // Also update the counterparty order if it exists
        if (order.counterparty_order_id) {
            await P2POrdersDAL.updateOrderStatus(order.counterparty_order_id, 'completed', {
                completed_at: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            message: 'P2P trade completed successfully',
            order: p2pMatchingService.getOrderSummary(order),
            xrpTransactionHash: xrpTransactionHash
        });
    } catch (error) {
        console.error('Error confirming XRP transfer:', error);
        res.status(400).json({
            success: false,
            error: 'Failed to confirm XRP transfer',
            message: error.message
        });
    }
});

// Cancel order
app.post('/api/p2p/cancel', createRateLimiter('conversion'), async (req, res) => {
    try {
        const { orderId, reason } = req.body;

        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: 'Missing orderId'
            });
        }

        const order = await P2POrdersDAL.getByOrderId(orderId);

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        // Cancel order
        p2pMatchingService.cancelOrder(order, reason);

        res.json({
            success: true,
            message: 'Order cancelled successfully',
            order: p2pMatchingService.getOrderSummary(order)
        });
    } catch (error) {
        console.error('Error cancelling order:', error);
        res.status(400).json({
            success: false,
            error: 'Failed to cancel order',
            message: error.message
        });
    }
});

// Raise dispute
app.post('/api/p2p/dispute', createRateLimiter('conversion'), async (req, res) => {
    try {
        const { orderId, reason, evidence } = req.body;

        if (!orderId || !reason) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['orderId', 'reason']
            });
        }

        const order = await P2POrdersDAL.getByOrderId(orderId);

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        // Raise dispute
        p2pMatchingService.raiseDispute(order, reason, evidence);

        res.json({
            success: true,
            message: 'Dispute raised successfully',
            order: p2pMatchingService.getOrderSummary(order),
            note: 'A moderator will review your dispute'
        });
    } catch (error) {
        console.error('Error raising dispute:', error);
        res.status(400).json({
            success: false,
            error: 'Failed to raise dispute',
            message: error.message
        });
    }
});

// Get P2P statistics
app.get('/api/p2p/stats', async (req, res) => {
    try {
        // Clean up expired orders in database
        await P2POrdersDAL.cleanupExpired();

        // Get stats from database
        const stats = await P2POrdersDAL.getStats();

        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error('Error fetching P2P stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch P2P stats',
            message: error.message
        });
    }
});

// Get payment methods
app.get('/api/p2p/payment-methods', (req, res) => {
    res.json({
        success: true,
        paymentMethods: Object.values(p2pMatchingService.PAYMENT_METHODS),
        descriptions: {
            [p2pMatchingService.PAYMENT_METHODS.BANK_TRANSFER]: 'Traditional bank transfer (EFT/Havale)',
            [p2pMatchingService.PAYMENT_METHODS.PAPARA]: 'Papara instant transfer',
            [p2pMatchingService.PAYMENT_METHODS.ININAL]: 'İninal card transfer',
            [p2pMatchingService.PAYMENT_METHODS.MEFETE]: 'Mefete instant transfer',
            [p2pMatchingService.PAYMENT_METHODS.QR_HAVALE]: 'QR code bank transfer'
        }
    });
});

// Log viewing endpoint
app.get('/api/logs', (req, res) => {
    res.json({
        success: true,
        message: 'Logs are available via Docker logs command',
        instructions: {
            docker_logs: 'docker logs cryptopay-app',
            docker_logs_follow: 'docker logs -f cryptopay-app',
            docker_logs_tail: 'docker logs cryptopay-app --tail 100',
            filter_papara: 'docker logs cryptopay-app | grep "[PAPARA]"',
            filter_server: 'docker logs cryptopay-app | grep "[SERVER]"',
            filter_p2p: 'docker logs cryptopay-app | grep "[P2P]"'
        },
        note: 'For real-time logs in browser, use the shared dashboard at /shared_dashboard.html'
    });
});

// Simple log viewer endpoint
app.get('/logs', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>CryptoPay Logs</title>
            <style>
                body { font-family: monospace; background: #1a1a1a; color: #00ff00; padding: 20px; }
                .header { color: #ffff00; font-size: 24px; margin-bottom: 20px; }
                .instruction { color: #00ffff; margin: 10px 0; }
                .command { background: #333; padding: 10px; border-radius: 5px; margin: 5px 0; }
                .note { color: #ff8800; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="header">🔍 CryptoPay Log Viewer</div>
            
            <div class="instruction">📋 Available Commands:</div>
            <div class="command">docker logs cryptopay-app</div>
            <div class="command">docker logs -f cryptopay-app</div>
            <div class="command">docker logs cryptopay-app --tail 100</div>
            
            <div class="instruction">🔍 Filter Logs:</div>
            <div class="command">docker logs cryptopay-app | grep "[PAPARA]"</div>
            <div class="command">docker logs cryptopay-app | grep "[SERVER]"</div>
            <div class="command">docker logs cryptopay-app | grep "[P2P]"</div>
            
            <div class="note">
                💡 For real-time browser logs, visit: 
                <a href="/shared_dashboard.html" style="color: #00ff00;">http://localhost:5001/shared_dashboard.html</a>
            </div>
            
            <div class="note">
                🎯 Main Application: 
                <a href="/" style="color: #00ff00;">http://localhost:5001</a>
            </div>
        </body>
        </html>
    `);
});

// ========================================================================
// PAPARA INTEGRATION API ENDPOINTS
// ========================================================================

// Validate Papara account number
app.post('/api/p2p/validate-papara-account', createRateLimiter('conversion'), async (req, res) => {
    console.log('🔍 [SERVER] validate-papara-account endpoint called');
    console.log('📥 [SERVER] Request body:', req.body);
    console.log('📥 [SERVER] Request headers:', req.headers);
    
    try {
        const { accountNumber } = req.body;
        console.log('🔍 [SERVER] Extracted accountNumber:', accountNumber);

        if (!accountNumber) {
            console.error('❌ [SERVER] Missing accountNumber in request');
            return res.status(400).json({
                success: false,
                error: 'Missing required field',
                required: ['accountNumber']
            });
        }

        console.log('📡 [SERVER] Calling Papara service validateAccount...');
        // Validate account using Papara service
        const validation = await p2pMatchingService.getPaparaService().validateAccount(accountNumber);
        console.log('📥 [SERVER] Papara validation result:', validation);

        const response = {
            success: validation.success,
            accountExists: validation.accountExists,
            accountHolder: validation.accountHolder,
            accountNumber: validation.accountNumber,
            message: validation.success ? 'Account validated successfully' : 'Account validation failed'
        };
        
        console.log('📤 [SERVER] Sending response:', response);
        res.json(response);

    } catch (error) {
        console.error('❌ [SERVER] Error validating Papara account:', {
            message: error.message,
            name: error.name,
            stack: error.stack,
            accountNumber: req.body?.accountNumber
        });
        
        const errorResponse = {
            success: false,
            error: 'Failed to validate Papara account',
            message: error.message
        };
        
        console.log('📤 [SERVER] Sending error response:', errorResponse);
        res.status(400).json(errorResponse);
    }
});

// Initiate Papara instant transfer payment
app.post('/api/p2p/initiate-papara-payment', createRateLimiter('conversion'), async (req, res) => {
    console.log('💰 [SERVER] initiate-papara-payment endpoint called');
    console.log('📥 [SERVER] Request body:', req.body);
    console.log('📥 [SERVER] Request headers:', req.headers);
    
    try {
        const { orderId, paparaAccountNumber } = req.body;
        console.log('🔍 [SERVER] Extracted parameters:', { orderId, paparaAccountNumber });

        if (!orderId || !paparaAccountNumber) {
            console.error('❌ [SERVER] Missing required fields:', { orderId, paparaAccountNumber });
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['orderId', 'paparaAccountNumber']
            });
        }

        console.log('📡 [SERVER] Fetching order from database...');
        // Get order from database
        const order = await P2POrdersDAL.getByOrderId(orderId);
        console.log('📥 [SERVER] Order from database:', order);

        if (!order) {
            console.error('❌ [SERVER] Order not found:', orderId);
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        console.log('🔍 [SERVER] Checking order status:', order.status);
        // Check if order is in correct status
        if (order.status !== 'matched') {
            console.error('❌ [SERVER] Order not in matched status:', { currentStatus: order.status, required: 'matched' });
            return res.status(400).json({
                success: false,
                error: 'Order must be matched before initiating payment',
                currentStatus: order.status
            });
        }

        console.log('📡 [SERVER] Processing Papara payment...');
        // Process Papara payment
        const paymentResult = await p2pMatchingService.processPaparaPayment(order, paparaAccountNumber);
        console.log('📥 [SERVER] Payment result:', paymentResult);

        if (!paymentResult.success) {
            console.error('❌ [SERVER] Payment initiation failed:', paymentResult);
            return res.status(400).json({
                success: false,
                error: 'Payment initiation failed',
                message: paymentResult.message
            });
        }

        console.log('💾 [SERVER] Updating order status in database...');
        // Update order with Papara transaction information
        await P2POrdersDAL.updateOrderStatus(order.order_id, 'payment_confirmed', {
            papara_transaction_id: paymentResult.transactionId,
            papara_payment_status: paymentResult.status,
            papara_account_number: paparaAccountNumber,
            payment_reference: paymentResult.referenceId,
            payment_confirmed_at: new Date().toISOString()
        });
        console.log('✅ [SERVER] Order status updated successfully');

        // Also update counterparty order
        if (order.counterparty_order_id) {
            console.log('💾 [SERVER] Updating counterparty order status...');
            await P2POrdersDAL.updateOrderStatus(order.counterparty_order_id, 'payment_confirmed', {
                counterparty_papara_account: paparaAccountNumber,
                payment_confirmed_at: new Date().toISOString()
            });
            console.log('✅ [SERVER] Counterparty order status updated successfully');
        }

        const response = {
            success: true,
            message: 'Papara payment initiated successfully',
            transactionId: paymentResult.transactionId,
            referenceId: paymentResult.referenceId,
            status: paymentResult.status,
            paymentUrl: paymentResult.paymentUrl,
            amount: paymentResult.amount,
            fee: paymentResult.fee,
            order: p2pMatchingService.getOrderSummary(order)
        };
        
        console.log('📤 [SERVER] Sending success response:', response);
        res.json(response);

    } catch (error) {
        console.error('❌ [SERVER] Error initiating Papara payment:', {
            message: error.message,
            name: error.name,
            stack: error.stack,
            orderId: req.body?.orderId,
            paparaAccountNumber: req.body?.paparaAccountNumber
        });
        
        const errorResponse = {
            success: false,
            error: 'Failed to initiate Papara payment',
            message: error.message
        };
        
        console.log('📤 [SERVER] Sending error response:', errorResponse);
        res.status(400).json(errorResponse);
    }
});

// Get Papara payment status
app.get('/api/p2p/papara-payment-status/:orderId', createRateLimiter('conversion'), async (req, res) => {
    try {
        const { orderId } = req.params;

        // Get order from database
        const order = await P2POrdersDAL.getByOrderId(orderId);

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        // Check if order has Papara transaction ID
        if (!order.papara_transaction_id) {
            return res.status(400).json({
                success: false,
                error: 'No Papara transaction found for this order'
            });
        }

        // Get payment status from Papara
        const statusResult = await p2pMatchingService.getPaparaPaymentStatus(order.papara_transaction_id);

        if (!statusResult.success) {
            return res.status(400).json({
                success: false,
                error: 'Failed to get payment status',
                message: statusResult.message
            });
        }

        // Update order status if payment is completed
        if (statusResult.status === 'completed' && order.status !== 'completed') {
            await P2POrdersDAL.updateOrderStatus(order.order_id, 'completed', {
                papara_payment_status: statusResult.status,
                completed_at: new Date().toISOString()
            });

            // Also update counterparty order
            if (order.counterparty_order_id) {
                await P2POrdersDAL.updateOrderStatus(order.counterparty_order_id, 'completed', {
                    completed_at: new Date().toISOString()
                });
            }
        }

        res.json({
            success: true,
            transactionId: statusResult.transactionId,
            status: statusResult.status,
            statusDescription: statusResult.statusDescription,
            amount: statusResult.amount,
            fee: statusResult.fee,
            createdAt: statusResult.createdAt,
            paymentMethod: statusResult.paymentMethod,
            paymentMethodDescription: statusResult.paymentMethodDescription,
            orderStatus: order.status
        });

    } catch (error) {
        console.error('Error getting Papara payment status:', error);
        res.status(400).json({
            success: false,
            error: 'Failed to get payment status',
            message: error.message
        });
    }
});

// Get Papara account balance
app.get('/api/p2p/papara-balance', createRateLimiter('conversion'), async (req, res) => {
    try {
        const balanceResult = await p2pMatchingService.getPaparaBalance();

        if (!balanceResult.success) {
            return res.status(400).json({
                success: false,
                error: 'Failed to get account balance',
                message: balanceResult.message
            });
        }

        res.json({
            success: true,
            balance: balanceResult.balance,
            currency: balanceResult.currency,
            accountNumber: balanceResult.accountNumber,
            merchantId: balanceResult.merchantId
        });

    } catch (error) {
        console.error('Error getting Papara balance:', error);
        res.status(400).json({
            success: false,
            error: 'Failed to get account balance',
            message: error.message
        });
    }
});

// ========================================================================
// END P2P TRY-XRP CONVERSION API
// ========================================================================

// Health check
// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        const dbHealth = await healthCheck();
        res.json({
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: dbHealth.healthy ? 'postgresql' : 'disconnected',
            database_healthy: dbHealth.healthy,
            database_error: dbHealth.error || null
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'error',
            error: error.message
        });
    }
});

// Get all wallets
app.get('/api/wallets', async (req, res) => {
    try {
        const wallets = await WalletsDAL.getAll();
        res.json({
            success: true,
            count: wallets.length,
            wallets: wallets.map(wallet => ({
                address: wallet.address,
                public_key: wallet.public_key,
                created_at: wallet.created_at,
                last_activity: wallet.last_activity,
                is_active: wallet.is_active
            }))
        });
    } catch (error) {
        console.error('Error fetching wallets:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch wallets'
        });
    }
});

// Add wallet
app.post('/api/wallets', async (req, res) => {
    try {
        const { address, seed, public_key, private_key } = req.body;
        
        if (!address || !public_key) {
            return res.status(400).json({
                success: false,
                error: 'Address and public_key are required'
            });
        }

        // Create or update wallet in database
        const wallet = await WalletsDAL.create({
            address,
            public_key,
            is_active: true
        });

        // Update last activity
        await WalletsDAL.updateActivity(address);
        
        res.json({ 
            success: true, 
            message: 'Wallet synced successfully',
            wallet: {
                address: wallet.address,
                public_key: wallet.public_key,
                is_active: wallet.is_active,
                created_at: wallet.created_at,
                last_activity: wallet.last_activity
            }
        });
    } catch (error) {
        console.error('Error syncing wallet:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync wallet'
        });
    }
});

// Get all transactions
app.get('/api/transactions', async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        
        const transactions = await TransactionsDAL.getAll(parseInt(limit), parseInt(offset));
        
        res.json({
            success: true,
            count: transactions.length,
            transactions: transactions.map(tx => ({
                hash: tx.hash,
                from_address: tx.from_address,
                to_address: tx.to_address,
                amount: tx.amount_xrp,
                memo: tx.memo,
                timestamp: tx.created_at,
                status: tx.status,
                block_number: tx.block_number,
                fee: tx.fee_xrp
            }))
        });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch transactions'
        });
    }
});

// Add transaction
app.post('/api/transactions', async (req, res) => {
    try {
        const { hash, from_address, to_address, amount, memo, timestamp, status, block_number, fee, raw_transaction } = req.body;
        
        if (!hash || !from_address || !to_address || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Hash, from_address, to_address, and amount are required'
            });
        }

        // Create or update transaction in database
        const transaction = await TransactionsDAL.create({
            hash,
            from_address,
            to_address,
            amount_xrp: parseFloat(amount),
            fee_xrp: parseFloat(fee) || 0,
            memo: memo || null,
            status: status || 'pending',
            block_number: block_number ? parseInt(block_number) : null,
            raw_transaction: raw_transaction ? JSON.stringify(raw_transaction) : null
        });
        
        res.json({ 
            success: true, 
            message: 'Transaction synced successfully',
            transaction: {
                hash: transaction.hash,
                from_address: transaction.from_address,
                to_address: transaction.to_address,
                amount: transaction.amount_xrp,
                status: transaction.status,
                created_at: transaction.created_at
            }
        });
    } catch (error) {
        console.error('Error syncing transaction:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync transaction'
        });
    }
});

// Get payment requests
app.get('/api/payment_requests', async (req, res) => {
    try {
        const { status, limit = 50 } = req.query;
        
        let paymentRequests;
        if (status) {
            paymentRequests = await PaymentRequestsDAL.getByStatus(status, parseInt(limit));
        } else {
            paymentRequests = await PaymentRequestsDAL.getAll(parseInt(limit));
        }
        
        res.json({
            success: true,
            count: paymentRequests.length,
            payment_requests: paymentRequests.map(req => ({
                request_id: req.request_id,
                amount: req.amount_xrp,
                from_address: req.from_address,
                to_address: req.to_address,
                memo: req.memo,
                status: req.status,
                created_at: req.created_at,
                paid_at: req.paid_at,
                expires_at: req.expires_at,
                transaction_hash: req.transaction_hash
            }))
        });
    } catch (error) {
        console.error('Error fetching payment requests:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch payment requests'
        });
    }
});

// Add payment request
app.post('/api/payment_requests', async (req, res) => {
    try {
        const { request_id, amount, from_address, to_address, memo, expires_at, qr_data } = req.body;
        
        if (!request_id || !amount || !from_address || !to_address) {
            return res.status(400).json({
                success: false,
                error: 'request_id, amount, from_address, and to_address are required'
            });
        }

        // Create or update payment request in database
        const paymentRequest = await PaymentRequestsDAL.create({
            request_id,
            from_address,
            to_address,
            amount_xrp: parseFloat(amount),
            memo: memo || null,
            qr_code_data: qr_data || null,
            expires_at: expires_at ? new Date(expires_at) : new Date(Date.now() + 30 * 60 * 1000) // 30 minutes default
        });
        
        res.json({ 
            success: true, 
            message: 'Payment request synced successfully',
            payment_request: {
                request_id: paymentRequest.request_id,
                amount: paymentRequest.amount_xrp,
                from_address: paymentRequest.from_address,
                to_address: paymentRequest.to_address,
                status: paymentRequest.status,
                created_at: paymentRequest.created_at,
                expires_at: paymentRequest.expires_at
            }
        });
    } catch (error) {
        console.error('Error syncing payment request:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync payment request'
        });
    }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        // Get stats from database using the function we created
        const result = await pool.query('SELECT get_app_stats() as stats');
        const stats = result.rows[0].stats;
        
        res.json({
            success: true,
            stats: {
                active_wallets: stats.active_wallets,
                total_transactions: stats.total_transactions,
                total_requests: stats.total_requests,
                pending_requests: stats.pending_requests,
                total_volume_xrp: parseFloat(stats.total_volume_xrp),
                recent_transactions_24h: stats.recent_transactions_24h,
                last_updated: stats.last_updated
            }
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch statistics'
        });
    }
});

// Export all data
app.get('/api/export', async (req, res) => {
    try {
        const [wallets, transactions, paymentRequests] = await Promise.all([
            WalletsDAL.getAll(),
            TransactionsDAL.getAll(1000, 0),
            PaymentRequestsDAL.getAll(1000)
        ]);

        res.json({
            success: true,
            data: {
                export_timestamp: new Date().toISOString(),
                wallets,
                transactions,
                payment_requests: paymentRequests,
                settings: []
            }
        });
    } catch (error) {
        console.error('Error exporting data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export data'
        });
    }
});

// Serve shared dashboard
app.get('/shared_dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'shared_dashboard.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Get local IP address
function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// Initialize database and start server
async function startServer() {
    try {
        // Test database connection
        console.log('🔄 Connecting to PostgreSQL database...');
        const connected = await testConnection();
        
        if (!connected) {
            console.error('❌ Failed to connect to database. Please check your PostgreSQL configuration.');
            process.exit(1);
        }

        // Run database migrations
        console.log('🔄 Running database migrations...');
        const { runMigrations } = require('./database/migrate');
        await runMigrations();

        // Start the server
        const server = app.listen(PORT, '0.0.0.0', () => {
            const localIP = getLocalIP();

            console.log('='.repeat(70));
            console.log('🚀 CryptoPay P2P TRY-XRP Exchange Server Started!');
            console.log('='.repeat(70));
            console.log(`📊 Database: PostgreSQL (Persistent Storage)`);
            console.log(`💱 Mode: P2P TRY to XRP conversion`);
            console.log(`🌐 Local URL: http://127.0.0.1:${PORT}`);
            console.log(`🌍 Network URL: http://${localIP}:${PORT}`);
            console.log('='.repeat(70));
            console.log('📚 Available Endpoints:');
            console.log(`   • API Docs: http://${localIP}:${PORT}/api`);
            console.log(`   • P2P Rate: http://${localIP}:${PORT}/api/p2p/rate`);
            console.log(`   • P2P Orders: http://${localIP}:${PORT}/api/p2p/orders`);
            console.log(`   • P2P Stats: http://${localIP}:${PORT}/api/p2p/stats`);
            console.log(`   • Payment Methods: http://${localIP}:${PORT}/api/p2p/payment-methods`);
            console.log(`   • Wallets: http://${localIP}:${PORT}/api/wallets`);
            console.log(`   • Transactions: http://${localIP}:${PORT}/api/transactions`);
            console.log(`   • Health: http://${localIP}:${PORT}/api/health`);
            console.log(`   • Dashboard: http://${localIP}:${PORT}/shared_dashboard.html`);
            console.log('='.repeat(70));
        });

        // Initialize WebSocket server
        if (process.env.NODE_ENV !== 'test') {
            initWebSocketServer(server);
        }
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

// Start the server (skipped when required by test harnesses)
if (process.env.CRYPTOPAY_SKIP_LISTEN !== 'true') {
    startServer();
}

module.exports = app;

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');
    const { closePool } = require('./database/connection');
    await closePool();
    console.log('✅ Server stopped');
    process.exit(0);
});