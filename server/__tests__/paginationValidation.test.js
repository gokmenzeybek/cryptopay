/**
 * Pagination parameter validation tests (PRD 5.1.2)
 * Non-numeric limit/offset must return 400, not a 500 from SQL LIMIT NaN.
 */

process.env.CRYPTOPAY_SKIP_LISTEN = 'true';

const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../../database/connection', () => ({
  pool: {
    query: jest.fn(),
    end: jest.fn(),
    connect: jest.fn()
  },
  testConnection: jest.fn().mockResolvedValue(true),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true })
}));

jest.mock('../../database/dal', () => ({
  WalletsDAL: {},
  TransactionsDAL: {
    getFiltered: jest.fn().mockResolvedValue([])
  },
  PaymentRequestsDAL: {
    getFiltered: jest.fn().mockResolvedValue([])
  },
  P2POrdersDAL: {
    getFiltered: jest.fn().mockResolvedValue([]),
    getByAddress: jest.fn().mockResolvedValue([])
  },
  PaparaPaymentsDAL: {}
}));

const { pool } = require('../../database/connection');
const app = require('../../server.production');

/**
 * Generate a syntactically valid XRPL address for route-param tests.
 * The returned address is asserted against the server's validation regex.
 */
function makeTestAddress(totalLength = 34) {
  const bodyLength = totalLength - 1;
  if (bodyLength < 24 || bodyLength > 33) {
    throw new Error('XRPL address body must be 24-33 chars');
  }
  const address = 'r' + 'a'.repeat(bodyLength);
  expect(address).toMatch(/^r[a-zA-Z0-9]{24,33}$/);
  return address;
}

const ADDRESS = makeTestAddress(34);

function token() {
  return jwt.sign({ address: ADDRESS }, process.env.JWT_SECRET);
}

describe('Pagination parameter validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [{ id: 1, address: ADDRESS, is_active: true }] });
  });

  describe('GET /api/p2p/orders', () => {
    it('returns 400 for non-numeric limit', async () => {
      const res = await request(app).get('/api/p2p/orders?limit=abc').expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for negative offset', async () => {
      const res = await request(app).get('/api/p2p/orders?offset=-1').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for limit above 100', async () => {
      const res = await request(app).get('/api/p2p/orders?limit=200').expect(400);
      expect(res.body.success).toBe(false);
    });

    it('accepts valid pagination', async () => {
      const res = await request(app).get('/api/p2p/orders?limit=10&offset=5').expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/p2p/my-orders/:address', () => {
    it('returns 400 for non-numeric limit', async () => {
      const res = await request(app)
        .get(`/api/p2p/my-orders/${ADDRESS}?limit=abc`)
        .set('Authorization', `Bearer ${token()}`)
        .expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
    });

    it('accepts valid pagination when authenticated', async () => {
      const res = await request(app)
        .get(`/api/p2p/my-orders/${ADDRESS}?limit=10&offset=0`)
        .set('Authorization', `Bearer ${token()}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/transactions', () => {
    it('returns 400 for non-numeric offset', async () => {
      const res = await request(app).get('/api/transactions?offset=xyz').expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
    });

    it('accepts valid pagination', async () => {
      const res = await request(app).get('/api/transactions?limit=25&offset=10').expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/payment_requests', () => {
    it('returns 400 for non-numeric limit and offset', async () => {
      const res = await request(app).get('/api/payment_requests?limit=abc&offset=def').expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
    });

    it('accepts valid pagination', async () => {
      const res = await request(app).get('/api/payment_requests?limit=10&offset=0').expect(200);
      expect(res.body.success).toBe(true);
    });
  });
});
