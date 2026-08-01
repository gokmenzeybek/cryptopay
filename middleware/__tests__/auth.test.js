/**
 * Unit Tests for Authentication Middleware + Auth Endpoints
 *
 * Fixed in Phase 7 (PRD 7.1.1): server.production must be required at top
 * level — jest.config has resetModules:true, so requiring it inside beforeAll
 * re-runs the connection mock factory and the app ends up with a different
 * pool mock instance than the one this file asserts against. Also mocks
 * ripple-keypairs (the server's actual signature verifier).
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const authMiddleware = require('../auth');

jest.mock('../../database/connection', () => ({
  pool: {
    query: jest.fn(),
    end: jest.fn(),
    connect: jest.fn()
  },
  testConnection: jest.fn().mockResolvedValue(true),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true })
}));

jest.mock('ripple-keypairs', () => ({
  ...jest.requireActual('ripple-keypairs'),
  verify: jest.fn()
}));

const { pool } = require('../../database/connection');
const rippleKeypairs = require('ripple-keypairs');
const app = require('../../server.production');

const JWT_SECRET = process.env.JWT_SECRET;

describe('Authentication & JWT Session Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('JWT Middleware (authMiddleware)', () => {
    let req, res, next;

    beforeEach(() => {
      req = { headers: {} };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis()
      };
      next = jest.fn();
    });

    test('should return 401 if Authorization header is missing', async () => {
      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: 'Access token is missing or invalid'
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    test('should return 401 if Authorization header does not start with Bearer', async () => {
      req.headers.authorization = 'Basic abc';
      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('should return 401 if token is invalid or expired', async () => {
      req.headers.authorization = 'Bearer invalid-token';
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

    test('should return 401 if token has no address payload', async () => {
      const token = jwt.sign({ foo: 'bar' }, JWT_SECRET);
      req.headers.authorization = `Bearer ${token}`;
      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Token payload is missing wallet address'
        })
      );
    });

    test('should return 401 if wallet is not registered in the database', async () => {
      const address = 'rTestAddress123';
      const token = jwt.sign({ address }, JWT_SECRET);
      req.headers.authorization = `Bearer ${token}`;

      pool.query.mockResolvedValueOnce({ rows: [] });

      await authMiddleware(req, res, next);
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT id, address, is_active, role FROM wallets WHERE address = $1',
        [address]
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Wallet not registered'
        })
      );
    });

    test('should return 401 if wallet is inactive', async () => {
      const address = 'rTestAddress123';
      const token = jwt.sign({ address }, JWT_SECRET);
      req.headers.authorization = `Bearer ${token}`;

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'wallet-uuid', address, is_active: false }]
      });

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Wallet is inactive'
        })
      );
    });

    test('should call next and populate req.user if token is valid and active', async () => {
      const address = 'rTestAddress123';
      const token = jwt.sign({ address }, JWT_SECRET);
      req.headers.authorization = `Bearer ${token}`;

      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'wallet-uuid', address, is_active: true, role: 'buyer' }]
      });

      await authMiddleware(req, res, next);
      expect(req.user).toEqual({ address, id: 'wallet-uuid', role: 'buyer' });
      expect(next).toHaveBeenCalled();
    });
  });

  describe('API Endpoints (Supertest)', () => {
    describe('POST /api/auth/challenge', () => {
      test('should generate nonce for valid address', async () => {
        const address = 'rTestAddress12345678901234567';
        pool.query.mockResolvedValueOnce({ rows: [] }); // DELETE query
        pool.query.mockResolvedValueOnce({ rows: [] }); // INSERT query

        const response = await request(app)
          .post('/api/auth/challenge')
          .send({ address })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.nonce).toBeDefined();
        expect(response.body.nonce).toHaveLength(64);
        expect(pool.query).toHaveBeenCalledWith(
          'DELETE FROM auth_challenges WHERE address = $1',
          [address]
        );
      });

      test('should fail if address is invalid', async () => {
        await request(app)
          .post('/api/auth/challenge')
          .send({ address: 'invalid' })
          .expect(400);
      });
    });

    describe('POST /api/auth/verify', () => {
      const address = 'rTestAddress12345678901234567';
      const publicKey = 'ED123456789';
      const signature = 'SIG123456789';
      const realXrpl = jest.requireActual('xrpl');

      beforeEach(() => {
        // mockReset (not mockClear) drops queued mockResolvedValueOnce values
        // so a failed test cannot leak queue entries into the next one.
        pool.query.mockReset();
        rippleKeypairs.verify.mockReset();
      });

      test('should issue token on valid signature and dynamic onboarding', async () => {
        const nonce = 'a'.repeat(64);
        const expiresAt = new Date(Date.now() + 60000); // in future

        // Use a genuine test keypair so the server's real xrpl.deriveAddress
        // matches the claimed address.
        const wallet = realXrpl.Wallet.generate();
        const realPublicKey = wallet.publicKey;
        const realAddress = wallet.address;

        // 1. DELETE challenge returning nonce
        pool.query.mockResolvedValueOnce({
          rows: [{ nonce, expires_at: expiresAt }]
        });
        rippleKeypairs.verify.mockReturnValue(true);

        // 2. Upsert wallet returning active wallet
        pool.query.mockResolvedValueOnce({
          rows: [{ id: 'new-wallet-uuid', address: realAddress, is_active: true }]
        });

        const response = await request(app)
          .post('/api/auth/verify')
          .send({ address: realAddress, publicKey: realPublicKey, signature })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.token).toBeDefined();

        // Assert challenge deletion occurred immediately (replay protection)
        expect(pool.query).toHaveBeenNthCalledWith(
          1,
          'DELETE FROM auth_challenges WHERE address = $1 RETURNING nonce, expires_at',
          [realAddress]
        );
      });

      test('should fail if challenge not found (replay protection / expired)', async () => {
        pool.query.mockResolvedValueOnce({ rows: [] });

        const response = await request(app)
          .post('/api/auth/verify')
          .send({ address, publicKey, signature })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Challenge not found');
      });

      test('should fail if challenge is expired', async () => {
        const nonce = 'a'.repeat(64);
        const expiresAt = new Date(Date.now() - 1000); // in past

        pool.query.mockResolvedValueOnce({
          rows: [{ nonce, expires_at: expiresAt }]
        });

        const response = await request(app)
          .post('/api/auth/verify')
          .send({ address, publicKey, signature })
          .expect(400);

        expect(response.body.error).toBe('Challenge expired');
      });

      test('should fail if public key does not derive into claimed address', async () => {
        const nonce = 'a'.repeat(64);
        const expiresAt = new Date(Date.now() + 60000);
        const wallet = realXrpl.Wallet.generate();

        pool.query.mockResolvedValueOnce({
          rows: [{ nonce, expires_at: expiresAt }]
        });

        const response = await request(app)
          .post('/api/auth/verify')
          .send({ address, publicKey: wallet.publicKey, signature })
          .expect(400);

        expect(response.body.error).toBe('Address mismatch');
      });

      test('should fail if signature is invalid', async () => {
        const nonce = 'a'.repeat(64);
        const expiresAt = new Date(Date.now() + 60000);
        const wallet = realXrpl.Wallet.generate();

        pool.query.mockResolvedValueOnce({
          rows: [{ nonce, expires_at: expiresAt }]
        });

        rippleKeypairs.verify.mockReturnValue(false); // invalid signature

        const response = await request(app)
          .post('/api/auth/verify')
          .send({ address: wallet.address, publicKey: wallet.publicKey, signature })
          .expect(400);

        expect(response.body.error).toBe('Invalid signature');
      });
    });
  });
});
