/**
 * Unit Tests for Database DAL Modules
 *
 * Rewritten in Phase 7 (PRD 7.1.1): the legacy suite asserted exact
 * single-line SQL strings from an older DAL generation. The current DALs use
 * multiline queries with explicit column lists and upserts, so SQL is now
 * compared whitespace-normalized; parameters are still asserted exactly.
 */

// Mock the database connection
const mockClient = {
  query: jest.fn(),
  release: jest.fn()
};
const mockPool = {
  query: jest.fn(),
  connect: jest.fn().mockResolvedValue(mockClient),
  end: jest.fn(),
  // readQuery delegates to pool.query in tests (no replica configured)
  readQuery: jest.fn()
};

jest.mock('../connection', () => ({
  pool: mockPool,
  readQuery: (text, params) => mockPool.readQuery(text, params)
}));

const { WalletsDAL, TransactionsDAL, PaymentRequestsDAL, P2POrdersDAL } = require('../dal');

/** Collapse all whitespace runs so multiline SQL compares reliably. */
const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

/** Assert the last pool.query call matches the normalized SQL and exact params. */
function expectQuery(sqlFragment, params) {
  const call = mockPool.query.mock.calls[mockPool.query.mock.calls.length - 1];
  expect(norm(call[0])).toBe(norm(sqlFragment));
  if (params) expect(call[1]).toEqual(params);
}

/** Assert the last readQuery call matches the normalized SQL and exact params. */
function expectReadQuery(sqlFragment, params) {
  const call = mockPool.readQuery.mock.calls[mockPool.readQuery.mock.calls.length - 1];
  expect(norm(call[0])).toBe(norm(sqlFragment));
  if (params) expect(call[1]).toEqual(params);
}

const ADDR1 = 'rTest1234567890123456789012345678901234';
const ADDR2 = 'rTest9876543210987654321098765432109876';

describe('Database DAL Modules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  describe('WalletsDAL', () => {
    describe('getAll', () => {
      it('should return all wallets', async () => {
        const mockWallets = [
          { address: ADDR1, public_key: 'k1', is_active: true },
          { address: ADDR2, public_key: 'k2', is_active: false }
        ];
        mockPool.query.mockResolvedValueOnce({ rows: mockWallets });

        const result = await WalletsDAL.getAll();

        expect(result).toEqual(mockWallets);
        expectQuery(
          'SELECT id, address, public_key, is_active, role, created_at, updated_at, last_activity FROM wallets ORDER BY created_at DESC'
        );
      });

      it('should handle database errors', async () => {
        mockPool.query.mockRejectedValueOnce(new Error('Database error'));
        await expect(WalletsDAL.getAll()).rejects.toThrow('Database error');
      });
    });

    describe('create', () => {
      it('should upsert a wallet and return the row', async () => {
        const row = { address: ADDR1, public_key: 'k1', is_active: true, id: 1 };
        mockPool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await WalletsDAL.create({
          address: ADDR1,
          public_key: 'k1',
          is_active: true
        });

        expect(result).toEqual(row);
        expectQuery(
          'INSERT INTO wallets (address, public_key, is_active, role) VALUES ($1, $2, $3, $4) ON CONFLICT (address) DO UPDATE SET public_key = EXCLUDED.public_key, is_active = EXCLUDED.is_active, role = EXCLUDED.role, updated_at = NOW() RETURNING id, address, public_key, is_active, role, created_at, updated_at, last_activity',
          [ADDR1, 'k1', true, 'buyer']
        );
      });
    });

    describe('updateActivity', () => {
      it('should update wallet activity', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [{ address: ADDR1 }] });

        await WalletsDAL.updateActivity(ADDR1);

        expectQuery(
          'UPDATE wallets SET last_activity = NOW(), updated_at = NOW() WHERE address = $1 RETURNING id, address, public_key, is_active, role, created_at, updated_at, last_activity',
          [ADDR1]
        );
      });
    });
  });

  describe('TransactionsDAL', () => {
    describe('getAll', () => {
      it('should return transactions with limit and offset', async () => {
        const mockTransactions = [{ hash: 'tx_hash_1', amount_xrp: 10.5 }];
        mockPool.query.mockResolvedValueOnce({ rows: mockTransactions });

        const result = await TransactionsDAL.getAll(10, 20);

        expect(result).toEqual(mockTransactions);
        expectQuery(
          'SELECT id, hash, from_address, to_address, amount_xrp, fee_xrp, memo, status, created_at, confirmed_at, block_number, raw_transaction FROM transactions ORDER BY created_at DESC LIMIT $1 OFFSET $2',
          [10, 20]
        );
      });

      it('should use default limit and offset', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [] });

        await TransactionsDAL.getAll();

        expectQuery(
          'SELECT id, hash, from_address, to_address, amount_xrp, fee_xrp, memo, status, created_at, confirmed_at, block_number, raw_transaction FROM transactions ORDER BY created_at DESC LIMIT $1 OFFSET $2',
          [50, 0]
        );
      });
    });

    describe('create', () => {
      it('should upsert a transaction with all fields as params', async () => {
        const transactionData = {
          hash: 'tx_hash_123',
          from_address: ADDR1,
          to_address: ADDR2,
          amount_xrp: 10.5,
          fee_xrp: 0.00001,
          memo: 'Test payment',
          status: 'completed',
          block_number: 12345,
          raw_transaction: '{"test": "data"}'
        };
        const row = { ...transactionData, id: 1 };
        mockPool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await TransactionsDAL.create(transactionData);

        expect(result).toEqual(row);
        const call = mockPool.query.mock.calls[0];
        expect(norm(call[0])).toContain(
          'INSERT INTO transactions (hash, from_address, to_address, amount_xrp, fee_xrp, memo, status, block_number, raw_transaction) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)'
        );
        expect(norm(call[0])).toContain('ON CONFLICT (hash) DO UPDATE');
        expect(call[1]).toEqual([
          transactionData.hash,
          transactionData.from_address,
          transactionData.to_address,
          transactionData.amount_xrp,
          transactionData.fee_xrp,
          transactionData.memo,
          transactionData.status,
          transactionData.block_number,
          transactionData.raw_transaction
        ]);
      });
    });
  });

  describe('PaymentRequestsDAL', () => {
    describe('getAll', () => {
      it('should return payment requests with limit', async () => {
        const mockRequests = [{ request_id: 'req_123', status: 'pending' }];
        mockPool.query.mockResolvedValueOnce({ rows: mockRequests });

        const result = await PaymentRequestsDAL.getAll(10);

        expect(result).toEqual(mockRequests);
        expectQuery(
          'SELECT id, request_id, from_address, to_address, amount_xrp, memo, status, qr_code_data, expires_at, created_at, paid_at, transaction_hash FROM payment_requests ORDER BY created_at DESC LIMIT $1 OFFSET $2',
          [10, 0]
        );
      });
    });

    describe('getByStatus', () => {
      it('should return payment requests by status', async () => {
        const mockRequests = [{ request_id: 'req_123', status: 'pending' }];
        mockPool.query.mockResolvedValueOnce({ rows: mockRequests });

        const result = await PaymentRequestsDAL.getByStatus('pending', 10);

        expect(result).toEqual(mockRequests);
        expectQuery(
          'SELECT id, request_id, from_address, to_address, amount_xrp, memo, status, qr_code_data, expires_at, created_at, paid_at, transaction_hash FROM payment_requests WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
          ['pending', 10, 0]
        );
      });
    });

    describe('create', () => {
      it('should upsert a payment request', async () => {
        const requestData = {
          request_id: 'req_123',
          from_address: ADDR1,
          to_address: ADDR2,
          amount_xrp: 5.0,
          memo: 'Test request',
          qr_code_data: 'qr_data_123',
          expires_at: new Date('2023-01-01T01:00:00Z')
        };
        const row = { ...requestData, id: 1, status: 'pending' };
        mockPool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await PaymentRequestsDAL.create(requestData);

        expect(result).toEqual(row);
        const call = mockPool.query.mock.calls[0];
        expect(norm(call[0])).toContain(
          'INSERT INTO payment_requests (request_id, from_address, to_address, amount_xrp, memo, qr_code_data, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)'
        );
        expect(call[1]).toEqual([
          requestData.request_id,
          requestData.from_address,
          requestData.to_address,
          requestData.amount_xrp,
          requestData.memo,
          requestData.qr_code_data,
          requestData.expires_at
        ]);
      });
    });
  });

  describe('P2POrdersDAL', () => {
    describe('getAll', () => {
       it('should return all P2P orders with limit', async () => {
        const mockOrders = [{ order_id: 'order_123', status: 'open' }];
        mockPool.readQuery.mockResolvedValueOnce({ rows: mockOrders });

        const result = await P2POrdersDAL.getAll(10);

        expect(result).toEqual(mockOrders);
        const call = mockPool.readQuery.mock.calls[0];
        expect(norm(call[0])).toContain('FROM p2p_orders ORDER BY created_at DESC LIMIT $1 OFFSET $2');
        expect(call[1]).toEqual([10, 0]);
      });
    });

    describe('getOpenOrders', () => {
      it('should return open, unexpired orders by type, oldest first', async () => {
        const mockOrders = [{ order_id: 'order_123', order_type: 'buy', status: 'open' }];
        mockPool.query.mockResolvedValueOnce({ rows: mockOrders });

        const result = await P2POrdersDAL.getOpenOrders('buy', 10);

        expect(result).toEqual(mockOrders);
        const call = mockPool.query.mock.calls[0];
        expect(norm(call[0])).toContain(
          "WHERE order_type = $1 AND status = 'open' AND expires_at > NOW() ORDER BY created_at ASC LIMIT $2"
        );
        expect(call[1]).toEqual(['buy', 10]);
      });
    });

    describe('getByTypeAndStatus', () => {
      it('should return orders by type and status', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [] });

        await P2POrdersDAL.getByTypeAndStatus('buy', 'matched', 10);

        const call = mockPool.query.mock.calls[0];
        expect(norm(call[0])).toContain(
          'WHERE order_type = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4'
        );
        expect(call[1]).toEqual(['buy', 'matched', 10, 0]);
      });
    });

    describe('getByAddress', () => {
      it('should return orders by address', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [] });

        await P2POrdersDAL.getByAddress(ADDR1, 10);

        const call = mockPool.query.mock.calls[0];
        expect(norm(call[0])).toContain(
          'WHERE xrpl_address = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3'
        );
        expect(call[1]).toEqual([ADDR1, 10, 0]);
      });
    });

    describe('getByOrderId', () => {
      it('should return order by ID', async () => {
        const mockOrder = { order_id: 'order_123' };
        mockPool.query.mockResolvedValueOnce({ rows: [mockOrder] });

        const result = await P2POrdersDAL.getByOrderId('order_123');

        expect(result).toEqual(mockOrder);
        const call = mockPool.query.mock.calls[0];
        expect(norm(call[0])).toContain('WHERE order_id = $1');
        expect(call[1]).toEqual(['order_123']);
      });

      it('should return null if order not found', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [] });

        const result = await P2POrdersDAL.getByOrderId('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('create', () => {
      it('should upsert a P2P order with all fields as params', async () => {
        const orderData = {
          order_id: 'order_123',
          xrpl_address: ADDR1,
          order_type: 'buy',
          amount_xrp: 10,
          amount_try: 100,
          rate: 10,
          payment_methods: ['bank_transfer'],
          expires_at: new Date('2023-01-01T01:00:00Z'),
          metadata: { test: 'data' }
        };
        const row = { ...orderData, id: 1, status: 'open' };
        mockPool.query.mockResolvedValueOnce({ rows: [row] });

        const result = await P2POrdersDAL.create(orderData);

        expect(result).toEqual(row);
        const call = mockPool.query.mock.calls[0];
        expect(norm(call[0])).toContain(
          'INSERT INTO p2p_orders (order_id, xrpl_address, order_type, amount_xrp, amount_try, rate, payment_methods, expires_at, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)'
        );
        expect(call[1]).toEqual([
          orderData.order_id,
          orderData.xrpl_address,
          orderData.order_type,
          orderData.amount_xrp,
          orderData.amount_try,
          orderData.rate,
          orderData.payment_methods,
          orderData.expires_at,
          orderData.metadata
        ]);
      });
    });

    describe('matchOrders', () => {
      it('should match two open orders in a transaction', async () => {
        mockClient.query
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
          .mockResolvedValueOnce({
            rows: [{ order_id: 'buy_123', status: 'matched' }],
            rowCount: 1
          }) // buy update
          .mockResolvedValueOnce({
            rows: [{ order_id: 'sell_123', status: 'matched' }],
            rowCount: 1
          }) // sell update
          .mockResolvedValueOnce({
            rows: [{ id: 1, buy_order_id: 'buy_123', sell_order_id: 'sell_123' }],
            rowCount: 1
          }) // match insert
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

        const result = await P2POrdersDAL.matchOrders('buy_123', 'sell_123');

        expect(result.buy_order.order_id).toBe('buy_123');
        expect(result.sell_order.order_id).toBe('sell_123');
        expect(result.match.buy_order_id).toBe('buy_123');
        expect(mockClient.query.mock.calls[0][0]).toBe('BEGIN');
        expect(norm(mockClient.query.mock.calls[4][0])).toBe('COMMIT');
        expect(mockClient.release).toHaveBeenCalled();
      });

      it('rolls back when the buy order is not open', async () => {
        mockClient.query
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // buy update: 0 rows
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

        await expect(
          P2POrdersDAL.matchOrders('buy_123', 'sell_123')
        ).rejects.toThrow('buy order buy_123 is not open');
        expect(mockClient.query.mock.calls[2][0]).toBe('ROLLBACK');
        expect(mockClient.release).toHaveBeenCalled();
      });
    });

    describe('cleanupExpired', () => {
      it('should expire open orders past their deadline and return the rows', async () => {
        const expired = [{ order_id: 'o1' }, { order_id: 'o2' }];
        mockPool.query.mockResolvedValueOnce({ rows: expired });

        const result = await P2POrdersDAL.cleanupExpired();

        expect(result).toEqual(expired);
        const call = mockPool.query.mock.calls[0];
        expect(norm(call[0])).toContain(
          "UPDATE p2p_orders SET status = 'expired', updated_at = NOW() WHERE status = 'open' AND expires_at < NOW()"
        );
      });
    });

    describe('getStats', () => {
       it('should return aggregated P2P order statistics', async () => {
        const mockStats = { total_orders: 100, open_orders: 20, avg_rate: 10.5 };
        mockPool.readQuery.mockResolvedValueOnce({ rows: [mockStats] });

        const result = await P2POrdersDAL.getStats();

        expect(result).toEqual(mockStats);
        const call = mockPool.readQuery.mock.calls[0];
        expect(norm(call[0])).toContain('COUNT(*) as total_orders');
        expect(norm(call[0])).toContain('FROM p2p_orders');
      });
    });
  });
});
