/**
 * CryptoPay Integration Tests
 * Comprehensive test suite for production readiness
 */

const request = require('supertest');
const { generateSeed, deriveKeypair, deriveAddress } = require('ripple-keypairs');
const app = require('../server.production');
const { pool } = require('../database/connection');

describe('CryptoPay Integration Tests', () => {
  let server;
  let token;
  let testAddress;
  let testPublicKey;
  let counterpartyAddress;
  
  beforeAll(async () => {
    // Generate a real XRPL keypair/address for the test user instead of
    // hardcoding a fake address.
    const seed = generateSeed();
    const keypair = deriveKeypair(seed);
    testAddress = deriveAddress(keypair.publicKey);
    testPublicKey = keypair.publicKey;

    const counterpartySeed = generateSeed();
    const counterpartyKeypair = deriveKeypair(counterpartySeed);
    counterpartyAddress = deriveAddress(counterpartyKeypair.publicKey);

    // Start server for testing
    server = app.listen(0);

    // Upsert test wallet to wallets table so authorization middleware passes
    // Set role to 'seller' so it can create sell orders in general integration tests.
    await pool.query(
      `INSERT INTO wallets (address, public_key, is_active, role)
       VALUES ($1, $2, true, 'seller')
       ON CONFLICT (address) DO UPDATE SET is_active = true, role = 'seller'`,
      [testAddress, testPublicKey]
    );

    // Sign a JWT token using the secret fallback key
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_key_change_me_in_prod';
    token = jwt.sign({ address: testAddress }, JWT_SECRET, { expiresIn: '1h' });
  });
  
  afterAll(async () => {
    // Close server and database connections
    if (server) server.close();
    if (pool) await pool.end();
  });
  
  beforeEach(async () => {
    // Clean up test data before each test
    await pool.query('DELETE FROM transactions WHERE memo LIKE $1', ['TEST_%']);
    await pool.query('DELETE FROM payment_requests WHERE memo LIKE $1', ['TEST_%']);
    await pool.query("DELETE FROM p2p_orders WHERE metadata->>'notes' LIKE $1", ['TEST_%']);
  });
  
  describe('Health Checks', () => {
    test('GET /health should return 200', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeDefined();
    });
    
    test('GET /api/health should return detailed health info', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);
      
      expect(response.body.status).toBe('healthy');
      expect(response.body.database).toBeDefined();
      expect(response.body.memory).toBeDefined();
    });
  });
  
  describe('API Documentation', () => {
    test('GET /api should return API documentation', async () => {
      const response = await request(app)
        .get('/api')
        .expect(200);
      
      expect(response.body.message).toBe('CryptoPay P2P TRY-XRP Exchange API');
      expect(response.body.version).toBe('3.0.0');
      expect(response.body.endpoints).toBeDefined();
    });
  });
  
  describe('P2P Exchange API', () => {
    test('GET /api/p2p/rate should return exchange rate', async () => {
      const response = await request(app)
        .get('/api/p2p/rate')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.currency).toBe('TRY');
      expect(response.body.rate).toBeDefined();
      expect(typeof response.body.rate).toBe('number');
    });
    
    test('POST /api/p2p/create-order should create buy order', async () => {
      const orderData = {
        type: 'buy',
        tryAmount: 100,
        xrpAmount: 10,
        xrplAddress: testAddress,
        paymentMethods: ['bank_transfer'],
        notes: 'TEST_ORDER'
      };
      
      const response = await request(app)
        .post('/api/p2p/create-order')
        .set('Authorization', 'Bearer ' + token)
        .send(orderData)
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.order).toBeDefined();
      expect(response.body.order.type).toBe('buy');
      expect(response.body.order.status).toBe('open');
    });
    
    test('POST /api/p2p/create-order should create sell order', async () => {
      const orderData = {
        type: 'sell',
        tryAmount: 100,
        xrpAmount: 10,
        xrplAddress: testAddress,
        paymentMethods: ['papara'],
        notes: 'TEST_ORDER'
      };
      
      const response = await request(app)
        .post('/api/p2p/create-order')
        .set('Authorization', 'Bearer ' + token)
        .send(orderData)
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.order).toBeDefined();
      expect(response.body.order.type).toBe('sell');
    });
    
    test('GET /api/p2p/orders should return orders list', async () => {
      const response = await request(app)
        .get('/api/p2p/orders')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.orders)).toBe(true);
      expect(response.body.pagination).toBeDefined();
    });
    
    test('GET /api/p2p/stats should return statistics', async () => {
      const response = await request(app)
        .get('/api/p2p/stats')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.stats).toBeDefined();
    });
  });
  
  describe('Core API', () => {
    test('GET /api/wallets should return the authenticated wallet only', async () => {
      const response = await request(app)
        .get('/api/wallets')
        .set('Authorization', 'Bearer ' + token)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.wallets)).toBe(true);
      expect(response.body.wallets.every(w => w.address === testAddress)).toBe(true);
    });

    test('POST /api/wallets without token should return 401', async () => {
      const response = await request(app)
        .post('/api/wallets')
        .send({ address: testAddress, publicKey: 'TEST_PUBLIC_KEY_123456789' })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('POST /api/wallets should create wallet for the authenticated user', async () => {
      const walletData = {
        address: testAddress,
        publicKey: 'TEST_PUBLIC_KEY_123456789'
      };

      const response = await request(app)
        .post('/api/wallets')
        .set('Authorization', 'Bearer ' + token)
        .send(walletData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.wallet).toBeDefined();
    });

    test('GET /api/transactions should return transactions list', async () => {
      const response = await request(app)
        .get('/api/transactions')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.transactions)).toBe(true);
    });

    test('POST /api/transactions without token should return 401', async () => {
      const transactionData = {
        hash: 'AA12345678901234567890123456789012345678901234567890123456789012',
        fromAddress: testAddress,
        toAddress: counterpartyAddress,
        amountXrp: 10.5,
        feeXrp: 0.000012,
        memo: 'TEST_TRANSACTION'
      };

      const response = await request(app)
        .post('/api/transactions')
        .send(transactionData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    test('POST /api/transactions should create transaction for the authenticated user', async () => {
      const transactionData = {
        hash: 'AA12345678901234567890123456789012345678901234567890123456789012',
        fromAddress: testAddress,
        toAddress: counterpartyAddress,
        amountXrp: 10.5,
        feeXrp: 0.000012,
        memo: 'TEST_TRANSACTION'
      };

      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', 'Bearer ' + token)
        .send(transactionData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.transaction).toBeDefined();
    });
    
    test('GET /api/payment_requests should return payment requests list', async () => {
      const response = await request(app)
        .get('/api/payment_requests')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.paymentRequests)).toBe(true);
    });
    
    test('POST /api/payment_requests should create payment request', async () => {
      const paymentRequestData = {
        amount: 25.5,
        recipientAddress: testAddress,
        memo: 'TEST_PAYMENT_REQUEST'
      };
      
      const response = await request(app)
        .post('/api/payment_requests')
        .set('Authorization', 'Bearer ' + token)
        .send(paymentRequestData)
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.paymentRequest).toBeDefined();
    });
    
    test('GET /api/stats should return statistics', async () => {
      const response = await request(app)
        .get('/api/stats')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.stats).toBeDefined();
      expect(typeof response.body.stats.totalWallets).toBe('number');
      expect(typeof response.body.stats.totalTransactions).toBe('number');
    });
  });
  
  describe('Error Handling', () => {
    test('POST /api/p2p/create-order should validate required fields', async () => {
      const response = await request(app)
        .post('/api/p2p/create-order')
        .set('Authorization', 'Bearer ' + token)
        .send({})
        .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
    
    test('POST /api/p2p/create-order should validate XRPL address format', async () => {
      const orderData = {
        type: 'buy',
        tryAmount: 100,
        xrpAmount: 10,
        xrplAddress: 'invalid_address',
        paymentMethods: ['bank_transfer']
      };
      
      const response = await request(app)
        .post('/api/p2p/create-order')
        .set('Authorization', 'Bearer ' + token)
        .send(orderData)
        .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
    
    test('POST /api/p2p/create-order should validate order type', async () => {
      const orderData = {
        type: 'invalid_type',
        tryAmount: 100,
        xrpAmount: 10,
        xrplAddress: testAddress,
        paymentMethods: ['bank_transfer']
      };
      
      const response = await request(app)
        .post('/api/p2p/create-order')
        .set('Authorization', 'Bearer ' + token)
        .send(orderData)
        .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
    
    test('POST /api/p2p/create-order should validate payment method', async () => {
      const orderData = {
        type: 'buy',
        tryAmount: 100,
        xrpAmount: 10,
        xrplAddress: testAddress,
        paymentMethods: ['invalid_method']
      };
      
      const response = await request(app)
        .post('/api/p2p/create-order')
        .set('Authorization', 'Bearer ' + token)
        .send(orderData)
        .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    test('POST /api/p2p/create-order should reject sell orders from users with buyer role', async () => {
      // Temporarily change role to 'buyer'
      await pool.query("UPDATE wallets SET role = 'buyer' WHERE address = $1", [testAddress]);
      
      try {
        const orderData = {
          type: 'sell',
          tryAmount: 100,
          xrpAmount: 10,
          rate: 10,
          xrplAddress: testAddress,
          paymentMethods: ['bank_transfer']
        };

        const response = await request(app)
          .post('/api/p2p/create-order')
          .set('Authorization', 'Bearer ' + token)
          .send(orderData)
          .expect(403);
        
        expect(response.body.success).toBe(false);
        expect(response.body.message).toMatch(/Only verified sellers/);
      } finally {
        // Restore role to 'seller' for other tests
        await pool.query("UPDATE wallets SET role = 'seller' WHERE address = $1", [testAddress]);
      }
    });
  });
  
  describe('Rate Limiting', () => {
    test('API endpoints should respect rate limits', async () => {
      const promises = [];
      
      // Exceed the default exchange-rates limit (60 requests/minute)
      for (let i = 0; i < 70; i++) {
        promises.push(
          request(app)
            .get('/api/p2p/rate')
        );
      }
      
      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });
  
  describe('Security Headers', () => {
    test('Response should include security headers', async () => {
      const response = await request(app)
        .get('/api')
        .expect(200);
      
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['x-xss-protection']).toBeDefined();
    });
  });
  
  describe('CORS', () => {
    test('Should handle CORS preflight requests', async () => {
      const response = await request(app)
        .options('/api/p2p/rate')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);
      
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });
  
  describe('Input Sanitization', () => {
    test('Should sanitize malicious input', async () => {
      const maliciousData = {
        type: 'buy',
        tryAmount: 100,
        xrpAmount: 10,
        xrplAddress: testAddress,
        paymentMethods: ['bank_transfer'],
        notes: '<script>alert("xss")</script>TEST_ORDER'
      };
      
      const response = await request(app)
        .post('/api/p2p/create-order')
        .set('Authorization', 'Bearer ' + token)
        .send(maliciousData)
        .expect(201);
      
      expect(response.body.success).toBe(true);
      expect(response.body.order.notes).not.toContain('<script>');
    });
  });
  
  describe('Database Transactions', () => {
    test('Should handle database errors gracefully', async () => {
      // This test would require mocking database errors
      // For now, we'll test that the app doesn't crash
      const response = await request(app)
        .get('/api/wallets')
        .set('Authorization', 'Bearer ' + token)
        .expect(200);
      
      expect(response.body.success).toBe(true);
    });
  });
  
  describe('Performance', () => {
    test('API responses should be fast', async () => {
      const start = Date.now();
      
      await request(app)
        .get('/api/health')
        .expect(200);
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Should respond within 1 second
    });
  });
});