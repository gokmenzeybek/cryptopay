/**
 * Unit Tests for Security Middleware (current middleware/security.js API)
 *
 * Rewritten in Phase 7 (PRD 7.1.1): the previous suite targeted a legacy API
 * (security.helmet/cors/ipWhitelist/requestSizeLimit/setSecurityHeaders) that
 * no longer exists. These tests cover the actual exports.
 */

const express = require('express');
const request = require('supertest');
const security = require('../security');

describe('Security Middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = { headers: {}, ip: '127.0.0.1', get: jest.fn() };
    mockRes = {
      setHeader: jest.fn(),
      removeHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      on: jest.fn()
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.CORS_ORIGINS;
    delete process.env.CORS_ORIGIN;
  });

  describe('securityHeaders (helmet)', () => {
    it('is a middleware function that sets security headers', () => {
      expect(typeof security.securityHeaders).toBe('function');
      security.securityHeaders(mockReq, mockRes, mockNext);
      const headerNames = mockRes.setHeader.mock.calls.map((c) => c[0]);
      expect(headerNames).toContain('Content-Security-Policy');
      expect(headerNames).toContain('X-Content-Type-Options');
      expect(mockNext).toHaveBeenCalled();
    });

    it('CSP allows the XRPL testnet websocket and disables upgrade-insecure-requests', () => {
      security.securityHeaders(mockReq, mockRes, mockNext);
      const cspCall = mockRes.setHeader.mock.calls.find(
        (c) => c[0] === 'Content-Security-Policy'
      );
      expect(cspCall).toBeDefined();
      expect(cspCall[1]).toContain('wss://s.altnet.rippletest.net:51233');
      expect(cspCall[1]).not.toContain('upgrade-insecure-requests');
    });
  });

  describe('corsOptions.origin', () => {
    const { origin } = security.corsOptions;

    it('allows requests with no origin (mobile apps, curl)', () => {
      const cb = jest.fn();
      origin(undefined, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('allows all origins outside production', () => {
      const cb = jest.fn();
      origin('http://anything.example', cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('in production, allows origins from CORS_ORIGINS', () => {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ORIGINS = 'https://app.example.com,https://admin.example.com';
      const cb = jest.fn();
      origin('https://app.example.com', cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('in production, accepts CORS_ORIGIN as an alias', () => {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ORIGIN = 'https://alias.example.com';
      const cb = jest.fn();
      origin('https://alias.example.com', cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('in production, rejects disallowed origins', () => {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ORIGINS = 'https://app.example.com';
      const cb = jest.fn();
      origin('http://malicious.example', cb);
      expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    });
  });

  describe('createRateLimiter', () => {
    it('returns middleware and allows requests under the limit', async () => {
      const app = express();
      app.use(security.createRateLimiter(60000, 2));
      app.get('/x', (req, res) => res.json({ ok: true }));

      const res1 = await request(app).get('/x');
      expect(res1.status).toBe(200);
    });

    it('blocks requests exceeding the limit with 429 and the standard payload', async () => {
      const app = express();
      app.use(security.createRateLimiter(60000, 1));
      app.get('/x', (req, res) => res.json({ ok: true }));

      await request(app).get('/x');
      const res2 = await request(app).get('/x');
      expect(res2.status).toBe(429);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error).toBe('Rate limit exceeded');
      expect(res2.body.retryAfter).toBe(60);
    });
  });

  describe('validateRequest', () => {
    it('passes requests with no validation errors', async () => {
      const app = express();
      app.use(express.json());
      app.post('/x', security.validateRequest, (req, res) => res.json({ ok: true }));
      const res = await request(app).post('/x').send({});
      expect(res.status).toBe(200);
    });

    it('rejects requests failing a validator chain with 400 + details', async () => {
      const app = express();
      app.use(express.json());
      app.post(
        '/x',
        security.validateXRPLAddress('address'),
        security.validateRequest,
        (req, res) => res.json({ ok: true })
      );
      const res = await request(app).post('/x').send({ address: 'not-an-address' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
      expect(Array.isArray(res.body.details)).toBe(true);
    });
  });

  describe('validator chains', () => {
    const buildApp = (chain, field) => {
      const app = express();
      app.use(express.json());
      app.post('/x', chain, security.validateRequest, (req, res) =>
        res.json({ ok: true })
      );
      return (body) => request(app).post('/x').send(body);
    };

    it('validateXRPLAddress accepts valid and rejects invalid addresses', async () => {
      const post = buildApp(security.validateXRPLAddress('address'));
      expect((await post({ address: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe' })).status).toBe(200);
      expect((await post({ address: 'bad' })).status).toBe(400);
    });

    it('validateTransactionHash enforces 64 hex chars', async () => {
      const post = buildApp(security.validateTransactionHash('hash'));
      const good = 'A'.repeat(64);
      expect((await post({ hash: good })).status).toBe(200);
      expect((await post({ hash: 'xyz' })).status).toBe(400);
    });

    it('validateAmount enforces a positive float above the minimum', async () => {
      const post = buildApp(security.validateAmount('amount'));
      expect((await post({ amount: 1.5 })).status).toBe(200);
      expect((await post({ amount: -3 })).status).toBe(400);
    });

    it('validateOrderType only allows buy/sell', async () => {
      const post = buildApp(security.validateOrderType('type'));
      expect((await post({ type: 'buy' })).status).toBe(200);
      expect((await post({ type: 'hold' })).status).toBe(400);
    });

    it('validatePaymentMethod allows known methods, singly or as arrays', async () => {
      const post = buildApp(security.validatePaymentMethod('paymentMethods'));
      expect((await post({ paymentMethods: ['papara', 'bank_transfer'] })).status).toBe(200);
      expect((await post({ paymentMethods: 'papara' })).status).toBe(200);
      expect((await post({ paymentMethods: ['western_union'] })).status).toBe(400);
    });

    it('validateOrderStatus allows known statuses only', async () => {
      const post = buildApp(security.validateOrderStatus('status'));
      expect((await post({ status: 'MATCHED' })).status).toBe(200);
      expect((await post({ status: 'BOGUS' })).status).toBe(400);
    });
  });

  describe('validateXRPLAddressParam / validateUUID', () => {
    it('validates the address route param', async () => {
      const app = express();
      app.get('/x/:address', security.validateXRPLAddressParam('address'), security.validateRequest, (req, res) =>
        res.json({ ok: true })
      );
      expect((await request(app).get('/x/rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')).status).toBe(200);
      expect((await request(app).get('/x/nope')).status).toBe(400);
    });

    it('validates UUID route params', async () => {
      const app = express();
      app.get('/x/:id', security.validateUUID('id'), security.validateRequest, (req, res) =>
        res.json({ ok: true })
      );
      expect(
        (await request(app).get('/x/123e4567-e89b-12d3-a456-426614174000')).status
      ).toBe(200);
      expect((await request(app).get('/x/not-a-uuid')).status).toBe(400);
    });
  });

  describe('validatePagination', () => {
    const app = express();
    app.get('/x', security.validatePagination(), security.validateRequest, (req, res) =>
      res.json({ ok: true })
    );

    it('accepts valid limit/offset and absent params', async () => {
      expect((await request(app).get('/x?limit=10&offset=0')).status).toBe(200);
      expect((await request(app).get('/x')).status).toBe(200);
    });

    it('rejects non-numeric, out-of-range, or negative values', async () => {
      expect((await request(app).get('/x?limit=abc')).status).toBe(400);
      expect((await request(app).get('/x?limit=0')).status).toBe(400);
      expect((await request(app).get('/x?limit=101')).status).toBe(400);
      expect((await request(app).get('/x?offset=-1')).status).toBe(400);
    });
  });

  describe('sanitizeInput', () => {
    it('strips script tags, javascript: URLs and inline event handlers from body strings', () => {
      mockReq.body = {
        a: '<script>alert("xss")</script>hello',
        b: 'javascript:alert(1)',
        c: 'x onload=evil()',
        d: 'plain',
        n: 42
      };
      security.sanitizeInput(mockReq, mockRes, mockNext);
      expect(mockReq.body.a).toBe('hello');
      expect(mockReq.body.b).toBe('alert(1)');
      expect(mockReq.body.c).toBe('x evil()');
      expect(mockReq.body.d).toBe('plain');
      expect(mockReq.body.n).toBe(42);
      expect(mockNext).toHaveBeenCalled();
    });

    it('sanitizes query parameters and leaves non-strings untouched', () => {
      mockReq.query = { q: '<script>x</script>term', page: '2' };
      security.sanitizeInput(mockReq, mockRes, mockNext);
      expect(mockReq.query.q).toBe('term');
      expect(mockReq.query.page).toBe('2');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('requestLogger', () => {
    it('registers a finish listener and calls next', () => {
      security.requestLogger(mockReq, mockRes, mockNext);
      expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function));
      expect(mockNext).toHaveBeenCalled();
    });

    it('logs at error level for 4xx/5xx and info level otherwise', () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      security.requestLogger(mockReq, mockRes, mockNext);
      mockRes.statusCode = 500;
      mockRes.on.mock.calls.find((c) => c[0] === 'finish')[1]();
      expect(errSpy).toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();

      errSpy.mockClear();
      security.requestLogger(mockReq, mockRes, mockNext);
      mockRes.statusCode = 200;
      mockRes.on.mock.calls.filter((c) => c[0] === 'finish').pop()[1]();
      expect(logSpy).toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();

      errSpy.mockRestore();
      logSpy.mockRestore();
    });
  });
});
