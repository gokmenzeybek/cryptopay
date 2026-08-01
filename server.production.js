#!/usr/bin/env node
/**
 * CryptoPay Production Server
 * Production-ready XRPL payment application with comprehensive security and monitoring
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const compression = require('compression');
const morgan = require('morgan');
const fs = require('fs');
const { body } = require('express-validator');

// Import security and error handling
const {
  securityHeaders,
  corsOptions,
  createRateLimiter,
  validateRequest,
  validateXRPLAddress,
  validateXRPLAddressParam,
  validateAmount,
  validateOrderType,
  validatePaymentMethod,
  validatePagination,
  sanitizeInput,
  requestLogger
} = require('./middleware/security');

const {
  errorHandler,
  catchAsync,
  handleUnhandledRejection,
  handleUncaughtException,
  handleSIGTERM,
  handleSIGINT
} = require('./middleware/errorHandler');

// Import logging
const logger = require('./utils/logger');

// Import services
const tryRateScraperService = require('./services/tryRateScraperService');
const p2pMatchingService = require('./services/p2pMatchingService');
const xrplEscrowService = require('./services/xrplEscrowService');
const burnerWalletService = require('./services/burnerWalletService');
const { initWebSocketServer, broadcastOrderUpdate } = require('./services/websocketService');

// Import database modules
const { pool, testConnection, healthCheck } = require('./database/connection');
const { WalletsDAL, TransactionsDAL, PaymentRequestsDAL, P2POrdersDAL, PaparaPaymentsDAL, SystemSettingsDAL } = require('./database/dal');

// Import authentication modules
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const xrpl = require('xrpl');
const rippleKeypairs = require('ripple-keypairs');
const authMiddleware = require('./middleware/auth');
// No fallback: JWT_SECRET is mandatory. startServer() refuses to boot in
// production without it (see validateEnvironment); in tests it is provided
// by tests/setup.js.
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Moderator guard — fails CLOSED. When MODERATOR_API_KEY is not configured,
 * moderator endpoints are unavailable (503) rather than open. When it is
 * configured, the x-moderator-key header must match (timing-safe comparison).
 */
const moderatorMiddleware = (req, res, next) => {
  const requiredKey = process.env.MODERATOR_API_KEY;
  if (!requiredKey) {
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'Moderator API is not configured on this server'
    });
  }
  const provided = req.headers['x-moderator-key'];
  const providedBuf = Buffer.from(typeof provided === 'string' ? provided : '');
  const requiredBuf = Buffer.from(requiredKey);
  const keysMatch = providedBuf.length === requiredBuf.length &&
    crypto.timingSafeEqual(providedBuf, requiredBuf);
  if (!keysMatch) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid or missing moderator key'
    });
  }
  next();
};

/**
 * Map domain service errors to a 400 JSON response.
 */
const domainError = (res, err, statusCode = 400) => res.status(statusCode).json({
  success: false,
  error: statusCode === 409 ? 'Conflict' : 'Bad Request',
  message: err.message
});

/**
 * Resolve the business order_id used by clients for a database row.
 */
const businessId = (order) => order.order_id || order.id;

// Cached system_settings reader (PRD 3.3.1) — 60s TTL
const SETTINGS_CACHE_TTL_MS = 60 * 1000;
let settingsCache = { value: null, expiresAt: 0 };
async function getSystemSettings() {
  if (settingsCache.value && Date.now() < settingsCache.expiresAt) {
    return settingsCache.value;
  }
  const value = await SystemSettingsDAL.getAll();
  settingsCache = { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
  return value;
}

// Load environment variables
require('dotenv').config();

// Create Express app
const app = express();

// Configuration
const PORT = process.env.PORT || 5001;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create logs directory if it doesn't exist
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
}

// ==============================================================================
// SECURITY MIDDLEWARE
// ==============================================================================

// Security headers
app.use(securityHeaders);

// CORS configuration
app.use(cors(corsOptions));

// Trust proxy (for rate limiting and IP detection). This value matches the
// single nginx reverse-proxy tier defined in docker-compose.yml. If you add
// additional proxies (e.g. a CDN or load balancer), increase this number to
// the number of proxy hops between the client and this application.
app.set('trust proxy', 1);

// ==============================================================================
// PERFORMANCE MIDDLEWARE
// ==============================================================================

// Compression
if (process.env.COMPRESSION_ENABLED !== 'false') {
  app.use(compression({
    level: parseInt(process.env.COMPRESSION_LEVEL) || 6,
    threshold: 1024
  }));
}

// ==============================================================================
// LOGGING MIDDLEWARE
// ==============================================================================

// HTTP request logging
if (process.env.LOG_REQUESTS !== 'false') {
  app.use(morgan('combined', { stream: logger.stream }));
}

// Custom request logger
app.use(requestLogger);

// ==============================================================================
// PARSING MIDDLEWARE
// ==============================================================================

// Body parsing
// The Papara webhook MUST verify its HMAC over the exact raw request bytes,
// so it gets a raw parser mounted before the JSON parser consumes the body.
app.use('/api/webhooks/papara', bodyParser.raw({ type: 'application/json', limit: '1mb' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Input sanitization
app.use(sanitizeInput);

// ==============================================================================
// HEALTH CHECKS
// ==============================================================================

// Basic health check (bypasses rate-limiting for infrastructure probes)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV
  });
});

// Detailed health check (bypasses rate-limiting for infrastructure probes)
app.get('/api/health', catchAsync(async (req, res) => {
  const dbHealth = await healthCheck();

  res.status(dbHealth.healthy ? 200 : 503).json({
    success: dbHealth.healthy,
    status: dbHealth.healthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    database: {
      status: dbHealth.healthy ? 'connected' : 'disconnected',
      type: 'postgresql',
      responseTime: dbHealth.responseTime
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB'
    }
  });
}));

// ==============================================================================
// DEBUG ENDPOINT
// ==============================================================================

app.get('/api/run-migrations', async (req, res) => {
  try {
    const { runMigrations } = require('./database/migrate');
    await runMigrations();
    res.json({ success: true, message: 'Migrations ran successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, stack: error.stack });
  }
});

// ==============================================================================
// RATE LIMITING
// ==============================================================================

// Global rate limiting
app.use(createRateLimiter(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
));

// ==============================================================================
// STATIC FILES
// ==============================================================================

app.use(express.static(path.join(__dirname, 'build'), {
  maxAge: NODE_ENV === 'production' ? '1d' : 0,
  etag: true,
  lastModified: true
}));

// ==============================================================================
// API ROUTES
// ==============================================================================

// API documentation
app.get('/api', (req, res) => {
  res.json({
    message: 'CryptoPay P2P TRY-XRP Exchange API',
    version: '3.0.0',
    environment: NODE_ENV,
    description: 'Production-ready peer-to-peer TRY to XRP conversion without third-party payment providers',
    endpoints: {
      health: '/api/health',
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
      p2p_prepare_escrow: '/api/p2p/prepare-escrow',
      p2p_submit_escrow_hash: '/api/p2p/submit-escrow-hash',
      moderator_disputes: '/api/moderator/disputes',
      moderator_resolve_dispute: '/api/moderator/resolve-dispute',
      p2p_stats: '/api/p2p/stats',
      stats: '/api/stats'
    },
    dashboard: '/shared_dashboard.html'
  });
});

// ==============================================================================
// AUTHENTICATION ENDPOINTS
// ==============================================================================

// Generate challenge nonce
app.post('/api/auth/challenge',
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_AUTH) || 10),
  [
    validateXRPLAddress('address'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { address } = req.body;
    const nonce = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

    // Delete prior challenges and insert new one
    await pool.query('DELETE FROM auth_challenges WHERE address = $1', [address]);
    await pool.query(
      'INSERT INTO auth_challenges (address, nonce, expires_at) VALUES ($1, $2, $3)',
      [address, nonce, expiresAt]
    );

    res.json({
      success: true,
      nonce
    });
  })
);

// Verify challenge signature and issue JWT
app.post('/api/auth/verify',
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_AUTH) || 10),
  [
    validateXRPLAddress('address'),
    body('publicKey').notEmpty().withMessage('Public key is required'),
    body('signature').notEmpty().withMessage('Signature is required'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { address, publicKey, signature } = req.body;

    // Retrieve and verify the challenge. Crucial: delete the challenge from the database immediately
    // before checking the signature to prevent replay and brute-force attacks.
    const deleteResult = await pool.query(
      'DELETE FROM auth_challenges WHERE address = $1 RETURNING nonce, expires_at',
      [address]
    );

    if (deleteResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Challenge not found',
        message: 'Challenge has expired or does not exist. Please request a new challenge.'
      });
    }

    const { nonce, expires_at } = deleteResult.rows[0];

    // Check expiry
    if (new Date() > new Date(expires_at)) {
      return res.status(400).json({
        success: false,
        error: 'Challenge expired',
        message: 'Challenge has expired. Please request a new challenge.'
      });
    }

    // Derive address from public key and check match
    let derivedAddress;
    try {
      derivedAddress = xrpl.deriveAddress(publicKey);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: 'Invalid public key',
        message: 'Failed to derive address from public key: ' + err.message
      });
    }

    if (derivedAddress !== address) {
      return res.status(400).json({
        success: false,
        error: 'Address mismatch',
        message: 'Derived address does not match the claimed address'
      });
    }

    // Verify signature of the message
    const message = `CryptoPay Challenge: ${nonce}`;
    const messageHex = Buffer.from(message, 'utf8').toString('hex').toUpperCase();

    let isSignatureValid = false;
    try {
      isSignatureValid = rippleKeypairs.verify(messageHex, signature, publicKey);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature format',
        message: 'Failed to verify signature: ' + err.message
      });
    }

    if (!isSignatureValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid signature',
        message: 'Signature verification failed'
      });
    }

    // Upsert the wallet in wallets table (dynamic onboarding)
    const upsertResult = await pool.query(
      `INSERT INTO wallets (address, public_key, is_active, updated_at, last_activity)
       VALUES ($1, $2, true, NOW(), NOW())
       ON CONFLICT (address) 
       DO UPDATE SET public_key = EXCLUDED.public_key, updated_at = NOW(), last_activity = NOW()
       RETURNING id, address, is_active`,
      [address, publicKey]
    );

    const wallet = upsertResult.rows[0];

    if (!wallet.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Wallet is inactive'
      });
    }

    // Sign a JWT
    const token = jwt.sign(
      { address: wallet.address },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token
    });
  })
);

// ==============================================================================
// BURNER WALLET ENDPOINTS (two-tier users)
// ==============================================================================

// Create a fresh burner wallet for a guest buyer session. The platform
// sponsors exactly the base reserve (0 spendable XRP); the seed is returned
// once and never persisted server-side. Aggressively rate-limited to prevent
// account farming.
app.post('/api/burner/wallets',
  createRateLimiter(15 * 60 * 1000, parseInt(process.env.RATE_LIMIT_BURNER) || 3),
  catchAsync(async (req, res) => {
    const burner = await burnerWalletService.createBurner();
    res.status(201).json({
      success: true,
      address: burner.address,
      seed: burner.seed,
      reserveXrp: burner.reserveXrp,
      token: burner.token
    });
  })
);

// ==============================================================================
// P2P TRY-XRP CONVERSION API ENDPOINTS
// ==============================================================================

// Get current XRP/TRY rate
app.get('/api/p2p/rate',
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_EXCHANGE_RATES) || 60),
  catchAsync(async (req, res) => {
    const forceRefresh = req.query.refresh === 'true';
    const currentOrders = await P2POrdersDAL.getAll(100);
    const rateData = await tryRateScraperService.getCurrentRate(forceRefresh, currentOrders);

    logger.logP2P('rate_fetch', { forceRefresh, rateData });

    res.json({
      success: true,
      currency: 'TRY',
      ...rateData,
      marketStats: tryRateScraperService.getMarketStats(rateData)
    });
  })
);

// Get supported payment methods
app.get('/api/p2p/payment-methods',
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 30),
  catchAsync(async (req, res) => {
    res.json({
      success: true,
      paymentMethods: [
        'bank_transfer',
        'papara',
        'ininal',
        'mefete',
        'qr_havale'
      ],
      descriptions: {
        'bank_transfer': 'Traditional bank transfer (EFT/Havale)',
        'papara': 'Papara instant transfer',
        'ininal': 'İninal card transfer',
        'mefete': 'Mefete instant transfer',
        'qr_havale': 'QR code bank transfer'
      }
    });
  })
);
// Broker on-ramp: find best seller + create matched buy order in one call
// (PRODUCT_PLAN §7.2 / M4). Buyer supplies a TRY amount and payment method;
// server picks the best open sell order that has a Papara account configured
// and returns pre-filled transfer instructions with a unique reference code.
app.post('/api/p2p/quick-match',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_PAYMENT_INTENT) || 10),
  [
    validateAmount('tryAmount'),
    body('paymentMethod')
      .notEmpty()
      .isIn(['bank_transfer', 'papara', 'ininal', 'mefete', 'qr_havale'])
      .withMessage('Invalid payment method'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { tryAmount, paymentMethod } = req.body;
    const buyerAddress = req.user.address;

    // 1. Current rate
    const rateData = await tryRateScraperService.getCurrentRate();
    const rate = rateData && rateData.rate;
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      return res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Could not determine the current XRP/TRY rate. Try again in a moment.'
      });
    }

    const tryAmt  = parseFloat(tryAmount);
    const xrpAmt  = tryAmt / rate;

    // 2. Enforce system_settings min/max
    const settings = await getSystemSettings();
    const minXrp = parseFloat(settings.min_order_amount_xrp);
    const maxXrp = parseFloat(settings.max_order_amount_xrp);
    if (Number.isFinite(minXrp) && xrpAmt < minXrp) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: `Amount is below the minimum of ${minXrp} XRP (≈ ₺${(minXrp * rate).toFixed(2)})`
      });
    }
    if (Number.isFinite(maxXrp) && xrpAmt > maxXrp) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: `Amount exceeds the maximum of ${maxXrp} XRP (≈ ₺${(maxXrp * rate).toFixed(2)})`
      });
    }

    // 3. Build a synthetic buy order for matching
    const syntheticBuy = p2pMatchingService.createP2POrder({
      type: 'buy',
      tryAmount: tryAmt,
      xrpAmount: xrpAmt,
      rate,
      xrplAddress: buyerAddress,
      paymentMethods: [paymentMethod],
      timeLimit: 30
    });

    // 4. Find open sell orders and filter to those with a Papara number set
    //    (option A: only match sellers who have configured their account)
    const allOrders = await P2POrdersDAL.getOpenOrders('sell', 100);
    const candidates = p2pMatchingService.findMatchingOrders(syntheticBuy, allOrders)
      .filter(o => {
        const meta = o.metadata || {};
        return meta.paparaNumber || meta.papara_number;
      });

    if (candidates.length === 0) {
      return res.status(503).json({
        success: false,
        error: 'No sellers available',
        message: 'No sellers are available for this amount and payment method right now. Try again in a few minutes.'
      });
    }

    const bestSeller = candidates[0];
    const sellerMeta = bestSeller.metadata || {};
    const paparaNumber = sellerMeta.paparaNumber || sellerMeta.papara_number;

    // 5. Unique reference code for reconciliation (stored on the buy order)
    const referenceCode = `QM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // 6. Create the buyer's order and persist it
    const buyOrder = await P2POrdersDAL.create({
      order_id: syntheticBuy.id,
      xrpl_address: buyerAddress,
      order_type: 'buy',
      amount_xrp: xrpAmt,
      amount_try: tryAmt,
      rate,
      payment_methods: [paymentMethod],
      expires_at: syntheticBuy.expiresAt,
      metadata: { source: 'quick-match', referenceCode }
    });

    // 7. Atomically match buy ↔ sell (throws if either is no longer open)
    const sellOrderId = businessId(bestSeller);
    try {
      await P2POrdersDAL.matchOrders(businessId(buyOrder), sellOrderId);
    } catch (err) {
      // Race: seller was matched by someone else — clean up the buyer order
      await P2POrdersDAL.update(businessId(buyOrder), { status: 'cancelled' });
      logger.warn('quick-match: sell order already taken, buyer order cancelled', {
        buyOrderId: businessId(buyOrder), sellOrderId, error: err.message
      });
      return res.status(503).json({
        success: false,
        error: 'Match conflict',
        message: 'The seller was taken by another buyer. Please try again.'
      });
    }

    // 8. Persist the reference code and counterparty address on the buy order
    await P2POrdersDAL.update(businessId(buyOrder), {
      payment_reference: referenceCode,
      counterparty_address: bestSeller.xrpl_address || bestSeller.xrplAddress
    });

    // Broadcast to both sides
    broadcastOrderUpdate(businessId(buyOrder), 'matched');
    broadcastOrderUpdate(sellOrderId, 'matched');

    logger.logP2P('quick_match_created', {
      buyOrderId: businessId(buyOrder),
      sellOrderId,
      tryAmt,
      xrpAmt,
      referenceCode
    });

    res.status(201).json({
      success: true,
      orderId: businessId(buyOrder),
      xrpAmount: parseFloat(xrpAmt.toFixed(6)),
      rate,
      paymentInstructions: {
        method: paymentMethod,
        paparaNumber,
        amount: tryAmt,
        currency: 'TRY',
        referenceCode,
        description: `CryptoPay ${referenceCode}`,
        timeLimitMinutes: 30
      },
      sellOrderId
    });
  })
);

// Create P2P order
app.post('/api/p2p/create-order',

  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_PAYMENT_INTENT) || 10),
  [
    validateOrderType('type'),
    validateAmount('tryAmount'),
    validateAmount('xrpAmount'),
    validateXRPLAddress('xrplAddress'),
    validatePaymentMethod('paymentMethods'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const {
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
    } = req.body;

    // Assert creator address matches authenticated user
    if (xrplAddress !== req.user.address) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Cannot create order for another wallet address'
      });
    }

    // Two-tier users: only verified sellers may post sell orders. Buy orders
    // remain open to any role (buyers trade from burner wallets).
    if (type === 'sell' && req.user.role !== 'seller') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only verified sellers can create sell orders'
      });
    }

    // Enforce order-book rules from system_settings (PRD 3.3.1)
    const settings = await getSystemSettings();
    const minXrp = parseFloat(settings.min_order_amount_xrp);
    const maxXrp = parseFloat(settings.max_order_amount_xrp);
    const requestedXrp = parseFloat(xrpAmount);

    if (Number.isFinite(minXrp) && requestedXrp < minXrp) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: `Order amount is below the minimum of ${minXrp} XRP`
      });
    }
    if (Number.isFinite(maxXrp) && requestedXrp > maxXrp) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: `Order amount exceeds the maximum of ${maxXrp} XRP`
      });
    }

    const maxOrders = parseInt(settings.max_orders_per_user, 10);
    if (Number.isFinite(maxOrders)) {
      const openCount = await P2POrdersDAL.countOpenByAddress(req.user.address);
      if (openCount >= maxOrders) {
        return res.status(429).json({
          success: false,
          error: 'Too Many Orders',
          message: `Maximum of ${maxOrders} open orders per user reached`
        });
      }
    }

    // Fall back to the current market rate when none is provided
    let effectiveRate = rate !== undefined && rate !== null ? parseFloat(rate) : null;
    if (!effectiveRate || !Number.isFinite(effectiveRate) || effectiveRate <= 0) {
      const currentRate = await tryRateScraperService.getCurrentRate();
      effectiveRate = currentRate && currentRate.rate ? currentRate.rate : null;
      if (!effectiveRate) {
        return res.status(503).json({
          success: false,
          error: 'Service Unavailable',
          message: 'Could not determine the current XRP/TRY rate; please provide a rate explicitly'
        });
      }
    }

    // Create order using the P2P matching service
    const order = p2pMatchingService.createP2POrder({
      type,
      tryAmount: parseFloat(tryAmount),
      xrpAmount: parseFloat(xrpAmount),
      rate: effectiveRate,
      xrplAddress,
      paymentMethods: Array.isArray(paymentMethods) ? paymentMethods : [paymentMethods],
      minAmount: minAmount ? parseFloat(minAmount) : null,
      maxAmount: maxAmount ? parseFloat(maxAmount) : null,
      timeLimit: timeLimit || 30,
      metadata: { ...(metadata || {}), ...(req.body.notes ? { notes: req.body.notes } : {}) }
    });

    // Save to database (map service fields to database columns)
    const savedOrder = await P2POrdersDAL.create({
      order_id: order.id,
      xrpl_address: order.xrplAddress,
      order_type: order.type,
      amount_xrp: order.xrpAmount,
      amount_try: order.tryAmount,
      rate: order.rate,
      payment_methods: order.paymentMethods,
      expires_at: order.expiresAt,
      metadata: order.metadata
    });

    // Find potential matches
    const allOrders = await P2POrdersDAL.getAll(100);
    const potentialMatches = p2pMatchingService.findMatchingOrders(order, allOrders)
      .slice(0, 5) // Limit to top 5 matches
      .map(match => p2pMatchingService.getOrderSummary(match));

    logger.logP2P('order_created', { orderId: order.id, type, tryAmount, xrpAmount });

    res.status(201).json({
      success: true,
      message: 'P2P order created successfully',
      order: p2pMatchingService.getOrderSummary(savedOrder),
      potentialMatches
    });
  })
);

// Get P2P orders
app.get('/api/p2p/orders',
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 30),
  ...validatePagination(),
  validateRequest,
  catchAsync(async (req, res) => {
    const { type, status = 'open', limit = 50, offset = 0 } = req.query;

    const orders = await P2POrdersDAL.getFiltered({
      type,
      status,
      limit: Math.min(parseInt(limit), 100),
      offset: parseInt(offset)
    });

    // Convert to API guide format
    const formattedOrders = orders.map(order => p2pMatchingService.getOrderSummary(order));

    res.json({
      success: true,
      count: formattedOrders.length,
      orders: formattedOrders,
      pagination: {
        limit: Math.min(parseInt(limit), 100),
        offset: parseInt(offset),
        count: formattedOrders.length
      }
    });
  })
);

// Get user's orders
app.get('/api/p2p/my-orders/:address',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 30),
  [
    validateXRPLAddressParam('address'),
    ...validatePagination(),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { address } = req.params;
    const { status, limit = 50, offset = 0 } = req.query;

    // Enforce ownership: param address must match authenticated user
    if (address !== req.user.address) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Cannot view orders for another wallet address'
      });
    }

    const orders = await P2POrdersDAL.getByAddress(address, {
      status,
      limit: Math.min(parseInt(limit), 100),
      offset: parseInt(offset)
    });

    // Convert to API guide format
    const formattedOrders = orders.map(order => ({
      id: order.id,
      type: order.type,
      status: order.status,
      tryAmount: order.tryAmount,
      xrpAmount: order.xrpAmount,
      rate: order.rate,
      counterpartyAddress: order.counterpartyAddress,
      matchedOrderId: order.matchedOrderId,
      // Escrow state for the escrow UI (PRD 4.6.3)
      escrowStatus: order.escrowStatus,
      escrowTransactionHash: order.escrowTransactionHash,
      createdAt: order.createdAt,
      completedAt: order.completedAt
    }));

    res.json({
      success: true,
      address,
      count: formattedOrders.length,
      orders: formattedOrders
    });
  })
);

// Match orders
app.post('/api/p2p/match',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_PAYMENT_INTENT) || 10),
  [
    body('orderId').notEmpty().withMessage('Order ID is required'),
    body('counterpartyOrderId').notEmpty().withMessage('Counterparty order ID is required'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { orderId, counterpartyOrderId } = req.body;

    // Get both orders
    const order1 = await P2POrdersDAL.getById(orderId);
    const order2 = await P2POrdersDAL.getById(counterpartyOrderId);

    if (!order1 || !order2) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'One or both orders not found'
      });
    }

    // Assert user is creator of one of the orders
    const creator1 = order1.xrpl_address || order1.xrplAddress;
    const creator2 = order2.xrpl_address || order2.xrplAddress;
    if (req.user.address !== creator1 && req.user.address !== creator2) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Must be creator of one of the orders to match them'
      });
    }

    // ---- Pre-match validation (PRD 3.1.2) ----
    const badRequest = (message) => res.status(400).json({ success: false, error: 'Bad Request', message });
    const conflict = (message) => res.status(409).json({ success: false, error: 'Conflict', message });

    const type1 = order1.order_type || order1.type;
    const type2 = order2.order_type || order2.type;
    const methods1 = order1.payment_methods || order1.paymentMethods || [];
    const methods2 = order2.payment_methods || order2.paymentMethods || [];

    if (orderId === counterpartyOrderId) {
      return badRequest('Cannot match an order with itself');
    }

    if (type1 === type2) {
      return badRequest(`Cannot match two ${type1} orders — one buy and one sell order are required`);
    }

    // Neither order may belong to an in-flight or completed trade
    if (order1.status !== 'open' || order2.status !== 'open') {
      return conflict(`Both orders must be open to match (current statuses: ${order1.status}, ${order2.status})`);
    }

    // Neither order may be expired
    const now = new Date();
    const expires1 = order1.expires_at || order1.expiresAt;
    const expires2 = order2.expires_at || order2.expiresAt;
    if ((expires1 && new Date(expires1) < now) || (expires2 && new Date(expires2) < now)) {
      return conflict('One or both orders have expired');
    }

    // Payment methods must overlap
    const commonMethods = methods1.filter(pm => methods2.includes(pm));
    if (commonMethods.length === 0) {
      return badRequest('No common payment method between the two orders');
    }

    // Rates must cross: buyer's max rate >= seller's ask rate
    const buyOrder = type1 === 'buy' ? order1 : order2;
    const sellOrder = type1 === 'buy' ? order2 : order1;
    if (Number(buyOrder.rate) < Number(sellOrder.rate)) {
      return badRequest(`Rates are not compatible (buy rate ${buyOrder.rate} < sell rate ${sellOrder.rate})`);
    }

    // Amounts must produce a positive trade
    const finalTry = Math.min(Number(buyOrder.amount_try ?? buyOrder.tryAmount), Number(sellOrder.amount_try ?? sellOrder.tryAmount));
    if (!Number.isFinite(finalTry) || finalTry <= 0) {
      return badRequest('Order amounts are not compatible — no positive trade amount');
    }

    // Compute match details (final amounts, rate, payment method, escrow prep)
    let matchResult;
    try {
      matchResult = p2pMatchingService.matchOrders(order1, order2);
    } catch (err) {
      return domainError(res, err);
    }

    // Atomically transition both orders to 'matched' in one transaction.
    // Throws if either order is no longer 'open' (race with another match/cancel).
    try {
      await P2POrdersDAL.matchOrders(businessId(buyOrder), businessId(sellOrder));
    } catch (err) {
      logger.warn('Order match failed at persistence layer', { orderId, counterpartyOrderId, error: err.message });
      return conflict(err.message);
    }

    // Persist non-critical match metadata (counterparty address + escrow prep fields)
    await P2POrdersDAL.update(businessId(order1), {
      counterpartyAddress: matchResult.order1.counterpartyAddress,
      escrowStatus: matchResult.order1.escrowStatus,
      escrowOwner: matchResult.order1.escrowOwner,
      escrowCancelAfter: matchResult.order1.escrowCancelAfter
    });
    await P2POrdersDAL.update(businessId(order2), {
      counterpartyAddress: matchResult.order2.counterpartyAddress,
      escrowStatus: matchResult.order2.escrowStatus,
      escrowOwner: matchResult.order2.escrowOwner,
      escrowCancelAfter: matchResult.order2.escrowCancelAfter
    });

    // Broadcast status updates to room clients
    broadcastOrderUpdate(businessId(order1), matchResult.order1.status);
    broadcastOrderUpdate(businessId(order2), matchResult.order2.status);

    logger.logP2P('orders_matched', { orderId, counterpartyOrderId });

    res.json({
      success: true,
      message: 'Orders matched successfully',
      match: {
        order1: {
          id: businessId(order1),
          status: matchResult.order1.status,
          counterpartyAddress: matchResult.order1.counterpartyAddress,
          matchedOrderId: matchResult.order1.matchedOrderId
        },
        order2: {
          id: businessId(order2),
          status: matchResult.order2.status,
          counterpartyAddress: matchResult.order2.counterpartyAddress,
          matchedOrderId: matchResult.order2.matchedOrderId
        },
        details: {
          tryAmount: matchResult.match.tryAmount,
          xrpAmount: matchResult.match.xrpAmount,
          rate: matchResult.match.rate,
          paymentMethod: matchResult.match.paymentMethod
        }
      },
      escrow: {
        ...matchResult.escrow,
        finishAfterSeconds: xrplEscrowService.FINISH_AFTER_SECONDS,
        prepareEndpoint: '/api/p2p/prepare-escrow'
      },
      nextStep: 'Seller should lock XRP via /api/p2p/prepare-escrow, then buyer transfers TRY via the agreed payment method and calls /api/p2p/confirm-payment'
    });
  })
);

// Confirm payment
app.post('/api/p2p/confirm-payment',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('orderId').notEmpty().withMessage('Order ID is required'),
    body('proofOfPayment').isObject().withMessage('Proof of payment is required'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { orderId, proofOfPayment } = req.body;

    // Get the order
    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'Order not found'
      });
    }

    // Assert user is the buyer
    const isBuyOrder = (order.order_type || order.type) === 'buy';
    const buyerAddress = isBuyOrder ?
      (order.xrpl_address || order.xrplAddress) :
      (order.counterparty_address || order.counterpartyAddress);

    if (req.user.address !== buyerAddress) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only the buyer can confirm payment'
      });
    }

    // Confirm payment
    try {
      await p2pMatchingService.confirmPayment(order, proofOfPayment);
    } catch (err) {
      return domainError(res, err);
    }

    // Update in database
    await P2POrdersDAL.update(businessId(order), order);

    // Broadcast status updates
    broadcastOrderUpdate(businessId(order), order.status);
    if (order.matched_order_id || order.matchedOrderId) {
      broadcastOrderUpdate(order.matched_order_id || order.matchedOrderId, order.status);
    }

    logger.logP2P('payment_confirmed', { orderId, proofOfPayment });

    res.json({
      success: true,
      message: 'TRY payment confirmed',
      order: {
        id: businessId(order),
        status: order.status,
        paymentConfirmedAt: order.paymentConfirmedAt
      },
      nextStep: 'Seller should now finish the escrow (or transfer XRP) and call /api/p2p/confirm-xrp with the transaction hash'
    });
  })
);

// Confirm XRP transfer
app.post('/api/p2p/confirm-xrp',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('orderId').notEmpty().withMessage('Order ID is required'),
    body('xrpTransactionHash').matches(/^[A-Fa-f0-9]{64}$/).withMessage('Invalid transaction hash'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { orderId, xrpTransactionHash } = req.body;

    // Get the order
    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'Order not found'
      });
    }

    // Assert user is the seller
    const isSellOrder = (order.order_type || order.type) === 'sell';
    const sellerAddress = isSellOrder ?
      (order.xrpl_address || order.xrplAddress) :
      (order.counterparty_address || order.counterpartyAddress);

    if (req.user.address !== sellerAddress) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only the seller can confirm XRP transfer'
      });
    }

    // Confirm XRP transfer with on-chain verification
    const client = new xrpl.Client(
      process.env.XRPL_TESTNET_URL || 'wss://s.altnet.rippletest.net:51233'
    );
    await client.connect();
    try {
      await p2pMatchingService.confirmXrpTransfer(order, xrpTransactionHash, client);
    } catch (err) {
      await client.disconnect();
      return domainError(res, err);
    }
    await client.disconnect();

    // Update in database
    await P2POrdersDAL.update(businessId(order), order);

    // If this completed trade's buyer used a burner wallet, flag it for the
    // AccountDelete sweeper (non-fatal — the sweeper also re-checks order
    // status on its own pass).
    if ((order.status === 'completed') && burnerWalletService) {
      const buyerAddress = (order.order_type || order.type) === 'buy'
        ? (order.xrpl_address || order.xrplAddress)
        : (order.counterparty_address || order.counterpartyAddress);
      if (buyerAddress) {
        try {
          await burnerWalletService.markOrderSettled(buyerAddress, orderId);
        } catch (err) {
          logger.warn('Could not mark burner settled (non-fatal)', {
            orderId, address: buyerAddress, error: err.message
          });
        }
      }
    }

    // If an escrow is locked for this trade, prepare the EscrowFinish.
    // The escrow stays 'finish_pending' until the EscrowFinish hash is
    // submitted and verified on-chain via /api/p2p/confirm-escrow-completion.
    let escrowResult = null;
    if ((order.escrow_status || order.escrowStatus) === xrplEscrowService.ESCROW_STATUS.LOCKED) {
      const isBuyOrder = (order.order_type || order.type) === 'buy';
      const sellerAddress = isBuyOrder ?
        (order.counterparty_address || order.counterpartyAddress) :
        (order.xrpl_address || order.xrplAddress);

      const condition = order.escrow_condition;
      const fulfillment = order.escrow_preimage;
      if (!condition || !fulfillment) {
        return domainError(res, new Error('Escrow condition/preimage not recorded for this order — prepare escrow first'));
      }

      const finishTx = xrplEscrowService.prepareEscrowFinish({
        account: sellerAddress,
        owner: order.escrow_owner || sellerAddress,
        offerSequence: order.escrow_sequence,
        condition,
        fulfillment
      });

      await P2POrdersDAL.updateEscrow(businessId(order), {
        escrow_status: xrplEscrowService.ESCROW_STATUS.FINISH_PENDING
      });

      escrowResult = {
        status: xrplEscrowService.ESCROW_STATUS.FINISH_PENDING,
        transaction: finishTx,
        nextStep: 'Sign and submit the EscrowFinish transaction on the XRPL, then call /api/p2p/confirm-escrow-completion with the transaction hash'
      };
      logger.logP2P('escrow_finish_prepared', { orderId, condition });
    }

    // Broadcast status updates
    broadcastOrderUpdate(businessId(order), order.status);
    if (order.matched_order_id || order.matchedOrderId) {
      broadcastOrderUpdate(order.matched_order_id || order.matchedOrderId, order.status);
    }

    logger.logP2P('xrp_confirmed', { orderId, xrpTransactionHash });

    res.json({
      success: true,
      message: 'P2P trade completed successfully',
      order: {
        id: businessId(order),
        status: order.status,
        xrpTransactionHash: order.xrpTransactionHash,
        xrpConfirmedAt: order.xrpConfirmedAt,
        completedAt: order.completedAt
      },
      xrpTransactionHash: order.xrpTransactionHash,
      ...(escrowResult ? { escrow: escrowResult } : {})
    });
  })
);

// Cancel order
app.post('/api/p2p/cancel',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('orderId').notEmpty().withMessage('Order ID is required'),
    body('reason').optional().isString().withMessage('Reason must be a string'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { orderId, reason } = req.body;

    // Get the order
    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'Order not found'
      });
    }

    // Authorization: open orders are creator-only; matched trades may be
    // cancelled by either trade party (PRD 3.2.1).
    const creatorAddress = order.xrpl_address || order.xrplAddress;
    const counterpartyAddress = order.counterparty_address || order.counterpartyAddress;
    const isCreator = req.user.address === creatorAddress;
    const isCounterparty = req.user.address === counterpartyAddress;
    if (order.status === 'open') {
      if (!isCreator) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: 'Only the order creator can cancel the order'
        });
      }
    } else if (!isCreator && !isCounterparty) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only the trade parties can cancel a matched order'
      });
    }

    // Cancel the order (open orders and matched trades are cancellable)
    const currentStatus = order.status;
    let escrowResult = null;

    if (currentStatus === 'open') {
      try {
        p2pMatchingService.cancelOrder(order, reason);
      } catch (err) {
        return domainError(res, err);
      }
    } else if (['matched', 'payment_confirmed'].includes(currentStatus)) {
      try {
        p2pMatchingService.cancelMatchedOrder(order, reason);
      } catch (err) {
        return domainError(res, err);
      }

      // Revert the counterparty order back to open so it can match again
      const counterpartyId = order.counterparty_order_id || order.matchedOrderId;
      if (counterpartyId) {
        const counterparty = await P2POrdersDAL.getById(counterpartyId);
        if (counterparty && p2pMatchingService.canTransition(counterparty.status, 'open')) {
          p2pMatchingService.transitionOrder(counterparty, 'open');
          await P2POrdersDAL.update(businessId(counterparty), {
            status: counterparty.status,
            counterpartyOrderId: null,
            counterpartyAddress: null,
            matchedAt: null
          });
          broadcastOrderUpdate(businessId(counterparty), 'open');
        }
      }

      if ((order.escrowStatus || order.escrow_status) === xrplEscrowService.ESCROW_STATUS.REFUNDED) {
        escrowResult = { status: xrplEscrowService.ESCROW_STATUS.REFUNDED };
        logger.logP2P('escrow_refunded', { orderId });
      }
    } else {
      return domainError(res, new Error(`Cannot cancel order in status: ${currentStatus}`));
    }

    // Update in database
    await P2POrdersDAL.update(businessId(order), order);
    if (order.escrowStatus && order.escrowStatus !== order.escrow_status) {
      await P2POrdersDAL.updateEscrow(businessId(order), { escrow_status: order.escrowStatus });
    }

    // Broadcast status updates
    broadcastOrderUpdate(businessId(order), order.status);
    if (order.matched_order_id || order.matchedOrderId) {
      broadcastOrderUpdate(order.matched_order_id || order.matchedOrderId, order.status);
    }

    logger.logP2P('order_cancelled', { orderId, reason });

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      order: {
        id: businessId(order),
        status: order.status,
        cancelledAt: order.cancelledAt,
        cancelReason: order.cancelReason
      },
      ...(escrowResult ? { escrow: escrowResult } : {})
    });
  })
);

// Raise dispute
app.post('/api/p2p/dispute',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('orderId').notEmpty().withMessage('Order ID is required'),
    body('reason').notEmpty().withMessage('Dispute reason is required'),
    body('evidence').optional().isObject().withMessage('Evidence must be an object'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { orderId, reason, evidence } = req.body;

    // Get the order
    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'Order not found'
      });
    }

    // Assert user is buyer or seller
    const creatorAddress = order.xrpl_address || order.xrplAddress;
    const counterpartyAddress = order.counterparty_address || order.counterpartyAddress;
    if (req.user.address !== creatorAddress && req.user.address !== counterpartyAddress) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only the buyer or seller can dispute the order'
      });
    }

    // Reject duplicate disputes with a conflict status
    if (order.status === 'disputed') {
      return domainError(res, new Error('Order is already disputed'), 409);
    }

    // Raise dispute
    try {
      p2pMatchingService.raiseDispute(order, reason, evidence);
    } catch (err) {
      return domainError(res, err);
    }

    // Update in database
    await P2POrdersDAL.update(businessId(order), order);

    // Broadcast status updates
    broadcastOrderUpdate(businessId(order), order.status);
    if (order.matched_order_id || order.matchedOrderId) {
      broadcastOrderUpdate(order.matched_order_id || order.matchedOrderId, order.status);
    }

    logger.logP2P('dispute_raised', { orderId, reason, evidence });

    res.json({
      success: true,
      message: 'Dispute raised successfully',
      order: {
        id: businessId(order),
        status: order.status,
        disputeReason: order.disputeReason,
        disputeRaisedAt: order.disputeRaisedAt
      },
      note: 'A moderator will review your dispute'
    });
  })
);

// ==============================================================================
// ESCROW ENDPOINTS
// ==============================================================================

// Prepare an EscrowCreate transaction for a matched trade
app.post('/api/p2p/prepare-escrow',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('orderId').notEmpty().withMessage('Order ID is required'),
    body('xrpAmount').isFloat({ gt: 0 }).withMessage('xrpAmount must be a positive number'),
    body('destinationAddress').custom((value) => xrpl.isValidClassicAddress(value)).withMessage('Invalid destination XRPL address'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { orderId, xrpAmount, destinationAddress } = req.body;

    // The order must exist and be in a matched trade (PRD 3.2.3)
    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'Order not found'
      });
    }

    if (order.status !== 'matched') {
      return res.status(409).json({
        success: false,
        error: 'Conflict',
        message: `Cannot prepare escrow for order in status: ${order.status}`
      });
    }

    // Determine trade parties: seller locks XRP, buyer receives it
    const orderType = order.order_type || order.type;
    const creatorAddress = order.xrpl_address || order.xrplAddress;
    const counterpartyAddress = order.counterparty_address || order.counterpartyAddress;
    const sellerAddress = orderType === 'sell' ? creatorAddress : counterpartyAddress;
    const buyerAddress = orderType === 'sell' ? counterpartyAddress : creatorAddress;

    // Only the seller may prepare (and later sign) the EscrowCreate
    if (req.user.address !== sellerAddress) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only the seller (escrow owner) can prepare the escrow'
      });
    }

    // The escrow destination must be the buyer of this trade
    if (destinationAddress !== buyerAddress) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'destinationAddress must be the buyer address of this trade'
      });
    }

    // The escrow amount must equal the trade amount:
    // finalTry = min(both TRY amounts), finalRate = buyer's rate
    let expectedXrp = null;
    const counterpartyId = order.counterparty_order_id;
    if (counterpartyId) {
      const counterparty = await P2POrdersDAL.getById(counterpartyId);
      if (counterparty) {
        const finalTry = Math.min(
          Number(order.amount_try ?? order.tryAmount),
          Number(counterparty.amount_try ?? counterparty.tryAmount)
        );
        const finalRate = Number(orderType === 'buy' ? order.rate : counterparty.rate);
        if (Number.isFinite(finalTry) && Number.isFinite(finalRate) && finalRate > 0) {
          expectedXrp = finalTry / finalRate;
        }
      }
    }

    const requestedXrp = parseFloat(xrpAmount);
    if (expectedXrp !== null && Math.abs(requestedXrp - expectedXrp) > 1e-6) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: `xrpAmount must equal the trade amount (${expectedXrp} XRP)`
      });
    }

    // Build unsigned EscrowCreate JSON (seller = authenticated user)
    const prepared = xrplEscrowService.prepareEscrowCreate({
      sourceAddress: req.user.address,
      destinationAddress,
      xrpAmount: requestedXrp,
      orderId
    });

    // Record that escrow was prepared for the order.
    // The preimage (fulfillment) is stored server-side and revealed only
    // inside the EscrowFinish flow after payment verification.
    if (['none', 'prepared', null, undefined].includes(order.escrow_status)) {
      await P2POrdersDAL.updateEscrow(orderId, {
        escrow_status: xrplEscrowService.ESCROW_STATUS.PREPARED,
        escrow_owner: req.user.address,
        escrow_condition: prepared.condition,
        escrow_preimage: prepared.fulfillment,
        escrow_cancel_after: new Date(Date.now() + xrplEscrowService.CANCEL_AFTER_SECONDS * 1000).toISOString()
      });
    }

    logger.logP2P('escrow_prepared', { orderId, condition: prepared.condition });

    res.json({
      success: true,
      transaction: prepared.transaction,
      condition: prepared.condition,
      finishAfter: prepared.finishAfter,
      cancelAfter: prepared.cancelAfter,
      nextStep: 'Sign and submit the EscrowCreate transaction on the XRPL, then call /api/p2p/submit-escrow-hash with the transaction hash'
    });
  })
);

// Record the EscrowCreate transaction hash (escrow locked on ledger)
app.post('/api/p2p/submit-escrow-hash',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('orderId').notEmpty().withMessage('Order ID is required'),
    body('txHash').matches(/^[A-Fa-f0-9]{64}$/).withMessage('Invalid transaction hash'),
    body('offerSequence').isInt({ gt: 0 }).withMessage('offerSequence must be a positive integer'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { orderId, txHash, offerSequence } = req.body;

    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'Order not found'
      });
    }

    // Verify the EscrowCreate on-chain; only the seller (escrow owner) may submit
    const client = new xrpl.Client(
      process.env.XRPL_TESTNET_URL || 'wss://s.altnet.rippletest.net:51233'
    );
    await client.connect();
    try {
      await p2pMatchingService.lockEscrowForOrder(order, {
        txHash,
        offerSequence: Number(offerSequence),
        callerAddress: req.user.address
      }, client);
    } catch (err) {
      await client.disconnect();
      if (err.statusCode === 403) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: err.message
        });
      }
      return domainError(res, err);
    }
    await client.disconnect();

    await P2POrdersDAL.updateEscrow(orderId, {
      escrow_status: xrplEscrowService.ESCROW_STATUS.LOCKED,
      escrow_transaction_hash: txHash,
      escrow_sequence: Number(offerSequence),
      escrow_created_at: new Date().toISOString()
    });

    logger.logP2P('escrow_locked', { orderId, txHash });

    res.json({
      success: true,
      status: 'locked',
      orderId,
      txHash
    });
  })
);

// Confirm an escrow finish/refund on-chain (EscrowFinish/EscrowCancel hash)
app.post('/api/p2p/confirm-escrow-completion',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('orderId').notEmpty().withMessage('Order ID is required'),
    body('txHash').matches(/^[A-Fa-f0-9]{64}$/).withMessage('Invalid transaction hash'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { orderId, txHash } = req.body;

    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'Order not found'
      });
    }

    // Verify the EscrowFinish/EscrowCancel on-chain before persisting the status
    const client = new xrpl.Client(
      process.env.XRPL_TESTNET_URL || 'wss://s.altnet.rippletest.net:51233'
    );
    await client.connect();
    let completion;
    try {
      completion = await p2pMatchingService.confirmEscrowCompletion(
        order, txHash, req.user.address, client
      );
    } catch (err) {
      await client.disconnect();
      if (err.statusCode === 403) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden',
          message: err.message
        });
      }
      return domainError(res, err);
    }
    await client.disconnect();

    await P2POrdersDAL.updateEscrow(orderId, {
      escrow_status: completion.escrowStatus,
      escrow_finished_at: new Date().toISOString()
    });

    logger.logP2P('escrow_completion_confirmed', { orderId, txHash, status: completion.escrowStatus });

    res.json({
      success: true,
      status: completion.escrowStatus,
      orderId,
      txHash
    });
  })
);

// ==============================================================================
// MODERATOR ENDPOINTS
// ==============================================================================

// List disputed orders (moderator dashboard)
app.get('/api/moderator/disputes',
  moderatorMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 30),
  catchAsync(async (req, res) => {
    const disputes = await P2POrdersDAL.getDisputed();

    res.json({
      success: true,
      count: disputes.length,
      disputes
    });
  })
);

// Resolve a dispute: release escrow to buyer or refund seller
app.post('/api/moderator/resolve-dispute',
  moderatorMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('orderId').notEmpty().withMessage('Order ID is required'),
    body('resolution').isIn(['release', 'refund']).withMessage('Resolution must be release or refund'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { orderId, resolution } = req.body;

    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'Order not found'
      });
    }

    if (order.status !== 'disputed') {
      return domainError(res, new Error(`Cannot resolve dispute for order in status: ${order.status}`));
    }

    const isBuyOrder = order.order_type === 'buy';
    const sellerAddress = isBuyOrder ? order.counterparty_address : order.xrpl_address;

    let escrowResult = null;
    const escrowLocked = order.escrow_status === xrplEscrowService.ESCROW_STATUS.LOCKED;

    if (resolution === 'release') {
      await P2POrdersDAL.updateOrderStatus(orderId, 'completed', { completed_at: new Date().toISOString() });

      if (escrowLocked) {
        const condition = order.escrow_condition;
        const fulfillment = order.escrow_preimage;
        if (!condition || !fulfillment) {
          return domainError(res, new Error('Escrow condition/preimage not recorded for this order — cannot release escrow'));
        }
        const finishTx = xrplEscrowService.prepareEscrowFinish({
          account: sellerAddress,
          owner: order.escrow_owner || sellerAddress,
          offerSequence: order.escrow_sequence,
          condition,
          fulfillment
        });
        // Escrow stays pending until the EscrowFinish hash is verified on-chain
        await P2POrdersDAL.updateEscrow(orderId, {
          escrow_status: xrplEscrowService.ESCROW_STATUS.FINISH_PENDING
        });
        escrowResult = {
          status: xrplEscrowService.ESCROW_STATUS.FINISH_PENDING,
          transaction: finishTx,
          nextStep: 'Sign and submit the EscrowFinish transaction on the XRPL, then call /api/p2p/confirm-escrow-completion with the transaction hash'
        };
      }

      broadcastOrderUpdate(orderId, 'completed');
      if (order.counterparty_order_id) {
        broadcastOrderUpdate(order.counterparty_order_id, 'completed');
      }
    } else {
      await P2POrdersDAL.updateOrderStatus(orderId, 'cancelled');

      if (escrowLocked) {
        const cancelTx = xrplEscrowService.prepareEscrowCancel({
          account: sellerAddress,
          owner: order.escrow_owner || sellerAddress,
          offerSequence: order.escrow_sequence
        });
        // Escrow stays pending until the EscrowCancel hash is verified on-chain
        await P2POrdersDAL.updateEscrow(orderId, {
          escrow_status: xrplEscrowService.ESCROW_STATUS.REFUND_PENDING
        });
        escrowResult = {
          status: xrplEscrowService.ESCROW_STATUS.REFUND_PENDING,
          transaction: cancelTx,
          nextStep: 'Sign and submit the EscrowCancel transaction on the XRPL, then call /api/p2p/confirm-escrow-completion with the transaction hash'
        };
      }

      broadcastOrderUpdate(orderId, 'cancelled');
      if (order.counterparty_order_id) {
        broadcastOrderUpdate(order.counterparty_order_id, 'cancelled');
      }
    }

    logger.logP2P('dispute_resolved', { orderId, resolution });

    const updated = await P2POrdersDAL.getById(orderId);

    res.json({
      success: true,
      message: `Dispute resolved: ${resolution}`,
      resolution,
      order: {
        id: businessId(updated),
        status: updated.status
      },
      ...(escrowResult ? { escrow: escrowResult } : {})
    });
  })
);

// List wallets with their role (sellers first) for the moderator dashboard
app.get('/api/moderator/sellers',
  moderatorMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 30),
  catchAsync(async (req, res) => {
    const all = await WalletsDAL.getAll();
    const sellers = all.filter((w) => w.role === 'seller');

    res.json({
      success: true,
      count: all.length,
      sellers,
      wallets: all
    });
  })
);

// Promote/demote a verified seller: set wallets.role to 'seller' | 'buyer'
app.post('/api/moderator/sellers',
  moderatorMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    validateXRPLAddress('address'),
    body('role').isIn(['seller', 'buyer']).withMessage('Role must be seller or buyer'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { address, role } = req.body;

    const updated = await WalletsDAL.setRole(address, role);
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Wallet not found',
        message: 'No wallet with that address is registered yet — the seller must complete signup first'
      });
    }

    logger.logP2P('seller_role_updated', { address, role });

    res.json({
      success: true,
      message: `Wallet role set to ${role}`,
      wallet: updated
    });
  })
);

// ==============================================================================
// PAPARA WEBHOOK ENDPOINT
// ==============================================================================

// Receive Papara instant transfer notifications (HMAC-signed)
app.post('/api/webhooks/papara',
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_WEBHOOK) || 60),
  catchAsync(async (req, res) => {
    const signature = req.headers['x-papara-signature'];
    // No fallback: the webhook secret must be configured. When it is not,
    // the endpoint is unavailable rather than forgeable.
    const secret = process.env.PAPARA_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Papara webhook is not configured on this server'
      });
    }

    // The HMAC must be computed over the EXACT raw request bytes — never
    // over a re-serialized req.body (key order/whitespace would change it).
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Webhook must be sent as application/json'
      });
    }
    const rawBody = req.body;

    // Verify HMAC-SHA256 signature over the raw payload
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const provided = typeof signature === 'string' ? signature.toLowerCase() : '';
    const signaturesMatch = provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    if (!signaturesMatch) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid webhook signature'
      });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Webhook payload is not valid JSON'
      });
    }

    const { referenceId, amount, status } = payload || {};
    if (!referenceId) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'referenceId is required'
      });
    }

    // Replay protection: reject webhooks whose timestamp is older than 5 minutes
    const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
    const payloadTimestamp = payload.timestamp || payload.createdAt;
    if (payloadTimestamp !== undefined && payloadTimestamp !== null) {
      const parsedTs = typeof payloadTimestamp === 'number'
        ? payloadTimestamp
        : Date.parse(payloadTimestamp);
      if (Number.isFinite(parsedTs) && Date.now() - parsedTs > WEBHOOK_MAX_AGE_MS) {
        logger.warn('Papara webhook rejected: stale timestamp', { referenceId });
        return res.status(400).json({
          success: false,
          error: 'Bad Request',
          message: 'Webhook timestamp is too old'
        });
      }
    }

    // Resolve the order from the referenceId mapping persisted at payment
    // initiation (papara_payments), never by treating referenceId as an order ID.
    const payment = await PaparaPaymentsDAL.getByReferenceId(referenceId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'No payment found for the given referenceId'
      });
    }

    // Idempotency: a second identical webhook is acknowledged without
    // re-advancing any state.
    if (payment.processed_at) {
      return res.json({
        success: true,
        message: 'Webhook already processed',
        orderId: payment.order_id
      });
    }

    const order = await P2POrdersDAL.getById(payment.order_id);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'No order found for the given referenceId'
      });
    }

    // Amount must match the order amount to prevent replay/misrouting
    const expectedAmount = parseFloat(order.amount_try);
    if (amount === undefined || Math.abs(parseFloat(amount) - expectedAmount) > 0.000001) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Webhook amount does not match the order amount'
      });
    }

    if (status !== 'completed') {
      return res.json({
        success: true,
        message: `Webhook received with status: ${status}`,
        orderStatus: order.status
      });
    }

    if (!p2pMatchingService.canTransition(order.status, 'payment_confirmed')) {
      return domainError(res, new Error(`Cannot process payment webhook for order in status: ${order.status}`));
    }

    // Mark the mapping processed first (idempotency guard), then advance state
    await PaparaPaymentsDAL.markProcessed(referenceId, 'completed');

    // Mark payment as confirmed and notify trade participants
    const updated = await P2POrdersDAL.updateStatus(payment.order_id, 'payment_confirmed', {
      payment_reference: referenceId
    });

    broadcastOrderUpdate(payment.order_id, 'payment_confirmed');
    if (order.counterparty_order_id) {
      broadcastOrderUpdate(order.counterparty_order_id, 'payment_confirmed');
    }

    logger.logP2P('papara_webhook_payment_confirmed', { orderId: payment.order_id, referenceId, amount });

    res.json({
      success: true,
      message: 'Payment confirmed via Papara webhook',
      order: {
        id: businessId(updated),
        status: updated.status
      }
    });
  })
);

// ==============================================================================
// PAPARA FRONTEND ENDPOINTS (PRD 4.2.1)
// ==============================================================================

// Validate a Papara account number (authenticated)
app.post('/api/p2p/validate-papara-account',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('accountNumber').notEmpty().withMessage('accountNumber is required'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { accountNumber } = req.body;

    const validation = await p2pMatchingService.getPaparaService().validateAccount(accountNumber);

    res.json({
      success: validation.success,
      accountExists: validation.accountExists,
      accountHolder: validation.accountHolder,
      accountNumber: validation.accountNumber,
      message: validation.success ? 'Account validated successfully' : 'Account validation failed'
    });
  })
);

// Initiate a Papara instant transfer for a matched trade (buyer only).
// Initiating a payment must NOT advance the order to payment_confirmed —
// confirmation comes only from the verified Papara webhook (PRD 2.6).
app.post('/api/p2p/initiate-papara-payment',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('orderId').notEmpty().withMessage('orderId is required'),
    body('paparaAccountNumber').notEmpty().withMessage('paparaAccountNumber is required'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { orderId, paparaAccountNumber } = req.body;

    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'Order not found'
      });
    }

    if (order.status !== 'matched') {
      return res.status(409).json({
        success: false,
        error: 'Conflict',
        message: `Order must be matched before initiating payment (current status: ${order.status})`
      });
    }

    // Only the buyer initiates the TRY transfer
    const orderType = order.order_type || order.type;
    const creatorAddress = order.xrpl_address || order.xrplAddress;
    const counterpartyAddress = order.counterparty_address || order.counterpartyAddress;
    const buyerAddress = orderType === 'buy' ? creatorAddress : counterpartyAddress;

    if (req.user.address !== buyerAddress) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only the buyer can initiate the Papara payment'
      });
    }

    const paymentResult = await p2pMatchingService.processPaparaPayment(order, paparaAccountNumber);

    if (!paymentResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Payment initiation failed',
        message: paymentResult.message
      });
    }

    logger.logP2P('papara_payment_initiated', { orderId, referenceId: paymentResult.referenceId });

    res.json({
      success: true,
      message: 'Papara payment initiated — awaiting webhook confirmation',
      transactionId: paymentResult.transactionId,
      referenceId: paymentResult.referenceId,
      status: paymentResult.status,
      paymentUrl: paymentResult.paymentUrl,
      amount: paymentResult.amount,
      fee: paymentResult.fee
    });
  })
);

// Get Papara payment status for an order (trade parties only)
app.get('/api/p2p/papara-payment-status/:orderId',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  catchAsync(async (req, res) => {
    const { orderId } = req.params;

    const order = await P2POrdersDAL.getById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        message: 'Order not found'
      });
    }

    const creatorAddress = order.xrpl_address || order.xrplAddress;
    const counterpartyAddress = order.counterparty_address || order.counterpartyAddress;
    if (req.user.address !== creatorAddress && req.user.address !== counterpartyAddress) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Only the trade parties can check the payment status'
      });
    }

    const payment = await PaparaPaymentsDAL.getByOrderId(orderId);
    if (!payment || !payment.transaction_id) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'No Papara payment found for this order'
      });
    }

    const statusResult = await p2pMatchingService.getPaparaPaymentStatus(payment.transaction_id);

    res.json({
      ...statusResult,
      orderStatus: order.status,
      referenceId: payment.reference_id
    });
  })
);

// Get P2P statistics
app.get('/api/p2p/stats',
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 10),
  catchAsync(async (req, res) => {
    const allOrders = await P2POrdersDAL.getAll(1000);
    const stats = p2pMatchingService.calculateOrderStats(allOrders);

    res.json({
      success: true,
      stats
    });
  })
);

// ==============================================================================
// CORE API ENDPOINTS
// ==============================================================================

// Get wallets
app.get('/api/wallets',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 30),
  catchAsync(async (req, res) => {
    const wallet = await WalletsDAL.getByAddress(req.user.address);

    res.json({
      success: true,
      wallets: wallet ? [wallet] : []
    });
  })
);

// Add wallet (authenticated — a user may only sync their own address)
app.post('/api/wallets',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 10),
  [
    validateXRPLAddress('address'),
    body('publicKey').notEmpty().withMessage('Public key is required'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { address, publicKey } = req.body;

    if (address !== req.user.address) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Wallet address does not match the authenticated user'
      });
    }

    const wallet = await WalletsDAL.create({ address, public_key: publicKey });

    logger.logDatabase('wallet_created', 'wallets', { address });

    res.status(201).json({
      success: true,
      message: 'Wallet synced successfully',
      wallet
    });
  })
);

// Get transactions
app.get('/api/transactions',
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 30),
  ...validatePagination(),
  validateRequest,
  catchAsync(async (req, res) => {
    const { limit = 50, offset = 0, address } = req.query;

    const transactions = await TransactionsDAL.getFiltered({
      address,
      limit: Math.min(parseInt(limit), 100),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      transactions,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: transactions.length
      }
    });
  })
);

// Add transaction (authenticated — fromAddress must belong to the caller)
app.post('/api/transactions',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 20),
  [
    body('hash').matches(/^[A-Fa-f0-9]{64}$/).withMessage('Invalid transaction hash'),
    validateXRPLAddress('fromAddress'),
    validateXRPLAddress('toAddress'),
    validateAmount('amountXrp'),
    validateAmount('feeXrp'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { hash, fromAddress, toAddress, amountXrp, feeXrp, memo } = req.body;

    if (fromAddress !== req.user.address) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'fromAddress does not match the authenticated user'
      });
    }

    const transaction = await TransactionsDAL.create({
      hash,
      from_address: fromAddress,
      to_address: toAddress,
      amount_xrp: amountXrp,
      fee_xrp: feeXrp,
      memo
    });

    logger.logDatabase('transaction_created', 'transactions', { hash });

    res.status(201).json({
      success: true,
      message: 'Transaction added successfully',
      transaction
    });
  })
);

// Get payment requests
app.get('/api/payment_requests',
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 30),
  ...validatePagination(),
  validateRequest,
  catchAsync(async (req, res) => {
    const { status, limit = 50, offset = 0 } = req.query;

    const paymentRequests = await PaymentRequestsDAL.getFiltered({
      status,
      limit: Math.min(parseInt(limit), 100),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      paymentRequests,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: paymentRequests.length
      }
    });
  })
);

// Add payment request
app.post('/api/payment_requests',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 10),
  [
    validateAmount('amount'),
    validateXRPLAddress('recipientAddress'),
    body('memo').optional().isString().withMessage('Memo must be a string'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { amount, recipientAddress, memo, senderAddress } = req.body;

    // Assert recipientAddress matches authenticated user
    if (recipientAddress !== req.user.address) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Cannot create payment request for another wallet address'
      });
    }

    const paymentRequest = await PaymentRequestsDAL.create({
      request_id: crypto.randomUUID(),
      from_address: senderAddress || req.user.address,
      to_address: recipientAddress,
      amount_xrp: amount,
      memo: memo || null,
      // Request links auto-expire after 30 days (PRODUCT_PLAN §8.2/§10.3)
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });

    logger.logDatabase('payment_request_created', 'payment_requests', { id: paymentRequest.id });

    res.status(201).json({
      success: true,
      message: 'Payment request created successfully',
      paymentRequest
    });
  })
);

// Resolve a payment request link (public — link possession is the capability;
// PRODUCT_PLAN §10.2). Returns only what the sender needs to pay it.
app.get('/api/payment_requests/:requestId',
  createRateLimiter(60 * 1000, 10),
  catchAsync(async (req, res) => {
    const request = await PaymentRequestsDAL.getByRequestId(req.params.requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Payment request not found'
      });
    }

    res.json({
      success: true,
      paymentRequest: {
        requestId: request.request_id,
        toAddress: request.to_address,
        amountXrp: parseFloat(request.amount_xrp),
        memo: request.memo,
        status: request.status,
        expiresAt: request.expires_at
      }
    });
  })
);

// Mark a request paid after the sender's payment settles on-chain
// (PRODUCT_PLAN §10.2). The tx hash is verified against the ledger.
app.patch('/api/payment_requests/:requestId/paid',
  authMiddleware,
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_CONVERSION) || 20),
  [
    body('txHash').matches(/^[A-Fa-f0-9]{64}$/).withMessage('Invalid transaction hash'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const { txHash } = req.body;

    const request = await PaymentRequestsDAL.getByRequestId(req.params.requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: 'Payment request not found'
      });
    }
    if (request.status === 'paid') {
      return res.status(409).json({
        success: false,
        error: 'Conflict',
        message: 'Payment request is already marked as paid'
      });
    }

    // Verify on-chain: the tx must be a successful Payment delivering at
    // least the requested amount to the request's recipient address.
    const client = new xrpl.Client(
      process.env.XRPL_TESTNET_URL || 'wss://s.altnet.rippletest.net:51233'
    );
    await client.connect();
    try {
      const txResponse = await client.request({ command: 'tx', transaction: txHash });
      const txJson = txResponse.result.tx_json || txResponse.result;
      const meta = txResponse.result.meta || {};

      if (meta.TransactionResult !== 'tesSUCCESS') {
        throw new Error('Transaction did not succeed on the ledger');
      }
      if (txJson.TransactionType !== 'Payment' || txJson.Destination !== request.to_address) {
        throw new Error('Transaction does not pay the request recipient');
      }
      const deliveredDrops = parseFloat(meta.delivered_amount || txJson.DeliverMax || txJson.Amount || 0);
      const requestedDrops = parseFloat(request.amount_xrp) * 1_000_000;
      if (!(deliveredDrops >= requestedDrops - 1)) { // 1-drop float tolerance
        throw new Error(`Transaction delivers less than the requested amount (${deliveredDrops / 1e6} XRP)`);
      }
    } catch (err) {
      await client.disconnect();
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: `Could not verify payment on-chain: ${err.message}`
      });
    }
    await client.disconnect();

    const updated = await PaymentRequestsDAL.markAsPaid(req.params.requestId, txHash);
    if (!updated) {
      return res.status(409).json({
        success: false,
        error: 'Conflict',
        message: 'Payment request could not be marked as paid (already paid?)'
      });
    }

    logger.logDatabase('payment_request_paid', 'payment_requests', { id: updated.id });

    res.json({
      success: true,
      paymentRequest: updated
    });
  })
);

// Get statistics
app.get('/api/stats',
  createRateLimiter(60 * 1000, parseInt(process.env.RATE_LIMIT_READ) || 10),
  catchAsync(async (req, res) => {
    const stats = await Promise.all([
      WalletsDAL.getCount(),
      TransactionsDAL.getCount(),
      PaymentRequestsDAL.getCount(),
      P2POrdersDAL.getCount()
    ]);

    res.json({
      success: true,
      stats: {
        totalWallets: stats[0],
        totalTransactions: stats[1],
        totalPaymentRequests: stats[2],
        totalP2POrders: stats[3]
      }
    });
  })
);

// ==============================================================================
// ERROR HANDLING
// ==============================================================================

// SPA fallback — serve React index.html for any non-API route so client-side
// routing (react-router) works for /pay, /p2p, /settings, /dashboard, etc.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    statusCode: 404
  });
});
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    statusCode: 404
  });
});

// Global error handler
app.use(errorHandler);

// ==============================================================================
// GRACEFUL SHUTDOWN
// ==============================================================================

// Handle unhandled promise rejections
handleUnhandledRejection();

// Handle uncaught exceptions
handleUncaughtException();

// Handle SIGTERM
handleSIGTERM();

// Handle SIGINT
handleSIGINT();

// ==============================================================================
// SERVER STARTUP
// ==============================================================================

/**
 * Fail-fast environment validation. In production the server refuses to boot
 * when required secrets are missing or still set to obvious placeholders —
 * there are no hardcoded fallbacks anywhere in the codebase, so a missing
 * secret here would otherwise surface as an exploitable or broken runtime.
 * Outside production a loud warning is logged instead of exiting.
 */
const validateEnvironment = () => {
  const REQUIRED_SECRETS = ['JWT_SECRET', 'PAPARA_WEBHOOK_SECRET', 'MODERATOR_API_KEY', 'PAPARA_API_KEY'];
  // Accept either discrete POSTGRES_PASSWORD or a full DATABASE_URL (Supabase/Render).
  if (!process.env.DATABASE_URL) {
    REQUIRED_SECRETS.push('POSTGRES_PASSWORD');
  }
  const PLACEHOLDER_PATTERN = /change_me|your_.*_here|fallback|placeholder|example/i;

  const missing = REQUIRED_SECRETS.filter((name) => !process.env[name] || process.env[name].trim() === '');
  const placeholders = REQUIRED_SECRETS.filter((name) => process.env[name] && PLACEHOLDER_PATTERN.test(process.env[name]));

  if (missing.length === 0 && placeholders.length === 0) return true;

  const problems = [
    ...missing.map((name) => `${name} is not set`),
    ...placeholders.map((name) => `${name} still looks like a placeholder`)
  ];

  if (NODE_ENV === 'production') {
    logger.error('Refusing to start in production with missing/placeholder secrets', { problems });
    return false;
  }

  logger.warn('Missing/placeholder secrets (allowed outside production, MUST be set in production)', { problems });
  return true;
};

const startServer = async () => {
  try {
    // Validate environment before opening any network surface
    if (!validateEnvironment()) {
      process.exit(1);
    }

    // Test database connection
    logger.info('Testing database connection...');
    const dbConnected = await testConnection();

    if (!dbConnected) {
      logger.error('Database connection failed');
      process.exit(1);
    }

    logger.info('Database connected successfully');

    // Automatically run database migrations to ensure schema is up-to-date
    logger.info('Running database migrations automatically on startup...');
    try {
      const { runMigrations } = require('./database/migrate');
      await runMigrations();
      logger.info('Startup migrations completed');
    } catch (migErr) {
      logger.error('Startup migration failed. You can retry via /api/run-migrations', { error: migErr.message });
    }

    // Start server. HTTPS is opt-in: set HTTPS_KEY + HTTPS_CERT (PEM file
    // paths, e.g. generated with mkcert — see docs/LOCAL_HTTPS_TESTING.md).
    // Needed for mobile camera access (getUserMedia requires a secure
    // context; plain HTTP on a LAN IP is not one).
    const httpsKeyPath = process.env.HTTPS_KEY;
    const httpsCertPath = process.env.HTTPS_CERT;
    let server;
    let protocol = 'http';
    if (httpsKeyPath && httpsCertPath) {
      if (!fs.existsSync(httpsKeyPath) || !fs.existsSync(httpsCertPath)) {
        logger.error('HTTPS_KEY/HTTPS_CERT set but file(s) not found', {
          HTTPS_KEY: httpsKeyPath,
          HTTPS_CERT: httpsCertPath
        });
        process.exit(1);
      }
      const https = require('https');
      const tlsOptions = {
        key: fs.readFileSync(httpsKeyPath),
        cert: fs.readFileSync(httpsCertPath)
      };
      // Optional CA chain (mkcert rootCA etc.) for clients that need it
      if (process.env.HTTPS_CA && fs.existsSync(process.env.HTTPS_CA)) {
        tlsOptions.ca = fs.readFileSync(process.env.HTTPS_CA);
      }
      protocol = 'https';
      server = https.createServer(tlsOptions, app).listen(PORT, HOST, () => {
        logger.info(`🚀 CryptoPay server running (HTTPS) on ${HOST}:${PORT}`, {
          environment: NODE_ENV,
          port: PORT,
          host: HOST,
          protocol,
          database: 'postgresql',
          version: '3.0.0'
        });
      });
    } else {
      server = app.listen(PORT, HOST, () => {
        logger.info(`🚀 CryptoPay server running on ${HOST}:${PORT}`, {
          environment: NODE_ENV,
          port: PORT,
          host: HOST,
          protocol,
          database: 'postgresql',
          version: '3.0.0'
        });
      });
    }

    // Initialize WebSocket server
    if (process.env.NODE_ENV !== 'test') {
      initWebSocketServer(server);
    }

    // Periodically unwind expired locked escrows (default cancel-after: 24h)
    if (process.env.NODE_ENV !== 'test') {
      const escrowSweepInterval = parseInt(process.env.ESCROW_SWEEP_INTERVAL_MS, 10) || 60 * 60 * 1000;
      const sweepExpiredEscrows = async () => {
        let client = null;
        try {
          const expired = await P2POrdersDAL.getExpiredLockedEscrows();
          if (expired.length > 0) {
            client = new xrpl.Client(
              process.env.XRPL_TESTNET_URL || 'wss://s.altnet.rippletest.net:51233'
            );
            await client.connect();
          }
          let cancelledCount = 0;
          for (const order of expired) {
            // Check the ledger first: only mark 'cancelled' when the escrow
            // object is gone on-chain (already cancelled/finished there).
            const classification = await p2pMatchingService.classifyExpiredEscrow(order, client);
            if (classification === 'cancelled') {
              await P2POrdersDAL.updateEscrow(order.order_id, {
                escrow_status: 'cancelled',
                escrow_finished_at: new Date().toISOString()
              });
              broadcastOrderUpdate(order.order_id, order.status);
              logger.logP2P('escrow_expired_cancelled', { orderId: order.order_id });
              cancelledCount += 1;
            } else if (classification === 'cancel_pending') {
              // Escrow still exists on-chain — do NOT mark cancelled; it must
              // be cancelled on-chain (EscrowCancel) first.
              await P2POrdersDAL.updateEscrow(order.order_id, {
                escrow_status: 'cancel_pending'
              });
              logger.logP2P('escrow_expired_still_on_ledger', { orderId: order.order_id });
            } else {
              logger.warn('Escrow sweep skipped order (ledger state unknown)', { orderId: order.order_id });
            }
          }
          if (cancelledCount > 0) {
            logger.info(`Escrow sweep: cancelled ${cancelledCount} expired escrow(s)`);
          }
        } catch (err) {
          logger.error('Escrow sweep failed', { error: err.message });
        } finally {
          if (client) {
            try { await client.disconnect(); } catch (err) { /* already closed */ }
          }
        }
      };
      const escrowTimer = setInterval(sweepExpiredEscrows, escrowSweepInterval);
      escrowTimer.unref();

      // Burner-wallet sweeper (two-tier users): destroys guest buyer wallets
      // whose session is over via AccountDelete, recovering the sponsored
      // reserve. No-op when SPONSOR_SEED is not configured.
      burnerWalletService.startSweeper();

      // Payment-request expiry sweep (PRODUCT_PLAN §10.3 / M3).
      // Marks pending requests whose expires_at has passed as 'expired'.
      // Default: every hour; override with PAYMENT_REQUEST_EXPIRY_INTERVAL_MS.
      const paymentRequestExpiryInterval =
        parseInt(process.env.PAYMENT_REQUEST_EXPIRY_INTERVAL_MS, 10) || 60 * 60 * 1000;
      const sweepExpiredPaymentRequests = async () => {
        try {
          const expired = await PaymentRequestsDAL.cleanupExpired();
          if (expired.length > 0) {
            logger.info(`Payment-request expiry sweep: marked ${expired.length} request(s) as expired`);
          }
        } catch (err) {
          logger.error('Payment-request expiry sweep failed', { error: err.message });
        }
      };
      // Run once on startup to catch any requests that expired while the
      // server was down, then on the configured interval thereafter.
      sweepExpiredPaymentRequests();
      const paymentRequestExpiryTimer = setInterval(sweepExpiredPaymentRequests, paymentRequestExpiryInterval);
      paymentRequestExpiryTimer.unref();
    }

    // Set server timeout
    server.timeout = parseInt(process.env.REQUEST_TIMEOUT) || 30000;

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);

      server.close(() => {
        logger.info('HTTP server closed');

        pool.end(() => {
          logger.info('Database pool closed');
          process.exit(0);
        });
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

// Start the server (skipped when the module is required by test harnesses
// that drive the app directly, e.g. via supertest)
if (process.env.CRYPTOPAY_SKIP_LISTEN !== 'true') {
  startServer();
}

module.exports = app;