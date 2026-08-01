/**
 * Comprehensive Gap and Stress Verification Tests for Milestone 1 Authentication
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server.production');
const { pool } = require('../database/connection');
const xrpl = require('xrpl');
const authMiddleware = require('../middleware/auth');

// Mock the database pool
jest.mock('../database/connection', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn()
  },
  testConnection: jest.fn().mockResolvedValue(true),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true }),
  closePool: jest.fn().mockResolvedValue(undefined)
}));

// Mock the xrpl library
jest.mock('xrpl', () => ({
  deriveAddress: jest.fn(),
  verifySignature: jest.fn(),
  isValidClassicAddress: jest.fn((a) => typeof a === 'string' && /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a))
}));

// Mock ripple-keypairs (used by the server for signature verification)
jest.mock('ripple-keypairs', () => ({
  sign: jest.fn(),
  verify: jest.fn()
}));

const rippleKeypairs = require('ripple-keypairs');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_key_change_me_in_prod';

describe('Milestone 1 Authentication - Comprehensive Stress & Gap Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('REST API Route Input Validation & Status Codes', () => {
    const validAddress = 'rTestAddress12345678901234567';

    test('POST /api/auth/challenge should return 400 when address is missing', async () => {
      const response = await request(app)
        .post('/api/auth/challenge')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.some(d => d.path === 'address')).toBe(true);
    });

    test('POST /api/auth/challenge should return 400 when address is malformed', async () => {
      const response = await request(app)
        .post('/api/auth/challenge')
        .send({ address: 'invalidAddress123' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    test('POST /api/auth/verify should return 400 when address is missing or malformed', async () => {
      const response = await request(app)
        .post('/api/auth/verify')
        .send({ publicKey: 'pubkey', signature: 'sig' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    test('POST /api/auth/verify should return 400 when publicKey is missing', async () => {
      const response = await request(app)
        .post('/api/auth/verify')
        .send({ address: validAddress, signature: 'sig' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.some(d => d.path === 'publicKey')).toBe(true);
    });

    test('POST /api/auth/verify should return 400 when signature is missing', async () => {
      const response = await request(app)
        .post('/api/auth/verify')
        .send({ address: validAddress, publicKey: 'pubkey' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.some(d => d.path === 'signature')).toBe(true);
    });
  });

  describe('Address & Public Key Verification Edge Cases', () => {
    const address = 'rTestAddress12345678901234567';
    const publicKey = 'ED123456789';
    const signature = 'SIG123456789';

    test('POST /api/auth/verify should fail with 400 if public key derivation throws an error', async () => {
      const nonce = 'a'.repeat(64);
      const expiresAt = new Date(Date.now() + 60000);

      pool.query.mockResolvedValueOnce({
        rows: [{ nonce, expires_at: expiresAt }]
      });

      xrpl.deriveAddress.mockImplementation(() => {
        throw new Error('Invalid key length');
      });

      const response = await request(app)
        .post('/api/auth/verify')
        .send({ address, publicKey, signature })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid public key');
      expect(response.body.message).toContain('Failed to derive address from public key: Invalid key length');
    });

    test('POST /api/auth/verify should fail with 400 if public key derives to different address', async () => {
      const nonce = 'a'.repeat(64);
      const expiresAt = new Date(Date.now() + 60000);

      pool.query.mockResolvedValueOnce({
        rows: [{ nonce, expires_at: expiresAt }]
      });

      xrpl.deriveAddress.mockReturnValue('rMismatchedAddress');

      const response = await request(app)
        .post('/api/auth/verify')
        .send({ address, publicKey, signature })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Address mismatch');
    });

    test('POST /api/auth/verify should fail with 400 if signature verification throws an error', async () => {
      const nonce = 'a'.repeat(64);
      const expiresAt = new Date(Date.now() + 60000);

      pool.query.mockResolvedValueOnce({
        rows: [{ nonce, expires_at: expiresAt }]
      });

      xrpl.deriveAddress.mockReturnValue(address);
      rippleKeypairs.verify.mockImplementation(() => {
        throw new Error('Malformed signature hex');
      });

      const response = await request(app)
        .post('/api/auth/verify')
        .send({ address, publicKey, signature })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid signature format');
      expect(response.body.message).toContain('Malformed signature hex');
    });
  });

  describe('Deactivated Wallet Verification (Status 403 / 401)', () => {
    const address = 'rTestAddress12345678901234567';
    const publicKey = 'ED123456789';
    const signature = 'SIG123456789';

    test('POST /api/auth/verify should return 403 Forbidden if wallet is deactivated during upsert', async () => {
      const nonce = 'a'.repeat(64);
      const expiresAt = new Date(Date.now() + 60000);

      pool.query.mockResolvedValueOnce({
        rows: [{ nonce, expires_at: expiresAt }]
      });

      xrpl.deriveAddress.mockReturnValue(address);
      rippleKeypairs.verify.mockReturnValue(true);

      // Upsert query returns deactivated wallet
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'wallet-uuid', address, is_active: false }]
      });

      const response = await request(app)
        .post('/api/auth/verify')
        .send({ address, publicKey, signature })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Forbidden');
      expect(response.body.message).toBe('Wallet is inactive');
    });

    test('authMiddleware should return 401 Unauthorized if wallet is deactivated in the database', async () => {
      const token = jwt.sign({ address }, JWT_SECRET);
      
      const req = {
        headers: {
          authorization: `Bearer ${token}`
        }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      const next = jest.fn();

      // Database returns wallet with is_active = false
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'wallet-uuid', address, is_active: false }]
      });

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: 'Wallet is inactive'
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Token Verification & Expiry Edge Cases', () => {
    test('authMiddleware should return 401 Unauthorized if token is expired', async () => {
      // Create a token expired 1 hour ago
      const token = jwt.sign({ address: 'rTestAddress12345678901234567' }, JWT_SECRET, { expiresIn: '-1h' });
      
      const req = {
        headers: {
          authorization: `Bearer ${token}`
        }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      // PRD 5.1.5: the 401 must NOT echo the raw JWT library message
      // (`details: 'jwt expired'`) — that field was removed as a leak.
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or expired token'
      });
      const body = res.json.mock.calls[0][0];
      expect(body).not.toHaveProperty('details');
      expect(next).not.toHaveBeenCalled();
    });

    test('authMiddleware should return 401 Unauthorized if token is malformed', async () => {
      const req = {
        headers: {
          authorization: 'Bearer malformed.token.here'
        }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: 'Invalid or expired token'
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Replay Attack Prevention via Atomic Nonce Deletion', () => {
    const address = 'rTestAddress12345678901234567';
    const publicKey = 'ED123456789';
    const signature = 'SIG123456789';

    test('Subsequent /api/auth/verify requests using the same nonce fail because the nonce is deleted on the first request', async () => {
      const nonce = 'a'.repeat(64);
      const expiresAt = new Date(Date.now() + 60000);

      // First call: challenge is found and deleted
      pool.query.mockResolvedValueOnce({
        rows: [{ nonce, expires_at: expiresAt }]
      });

      xrpl.deriveAddress.mockReturnValue(address);
      rippleKeypairs.verify.mockReturnValue(true);

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'wallet-uuid', address, is_active: true }]
      });

      // Execute first request
      const response1 = await request(app)
        .post('/api/auth/verify')
        .send({ address, publicKey, signature })
        .expect(200);

      expect(response1.body.success).toBe(true);
      expect(response1.body.token).toBeDefined();

      // Second call (replay): challenge has already been deleted from DB, so query returns empty rows
      pool.query.mockResolvedValueOnce({
        rows: []
      });

      // Execute second request
      const response2 = await request(app)
        .post('/api/auth/verify')
        .send({ address, publicKey, signature })
        .expect(400);

      expect(response2.body.success).toBe(false);
      expect(response2.body.error).toBe('Challenge not found');
    });
  });
});
