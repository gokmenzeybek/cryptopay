/**
 * P2POrdersDAL.matchOrders atomicity tests (PRD 3.1.1)
 * Uses a transaction-spying mocked pool: no real Postgres needed.
 */

jest.mock('../connection', () => ({
  pool: {
    connect: jest.fn(),
    query: jest.fn(),
    healthCheck: jest.fn()
  }
}));

const { pool } = require('../connection');
const P2POrdersDAL = require('../dal/p2pOrders');

describe('P2POrdersDAL.matchOrders atomicity', () => {
  let client;

  beforeEach(() => {
    client = {
      query: jest.fn(),
      release: jest.fn()
    };
    pool.connect.mockResolvedValue(client);
  });

  test('both updates succeed → commits and returns orders + match', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ order_id: 'b1', status: 'matched', matched_at: 't' }], rowCount: 1 }) // buy update
      .mockResolvedValueOnce({ rows: [{ order_id: 's1', status: 'matched', matched_at: 't' }], rowCount: 1 }) // sell update
      .mockResolvedValueOnce({ rows: [{ id: 1, buy_order_id: 'b1', sell_order_id: 's1', status: 'active' }], rowCount: 1 }) // insert match
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

    const result = await P2POrdersDAL.matchOrders('b1', 's1');

    expect(result.buy_order.order_id).toBe('b1');
    expect(result.sell_order.order_id).toBe('s1');
    expect(result.match.buy_order_id).toBe('b1');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('buy order not open → throws descriptive error, ROLLBACK, no match insert', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // buy update matches nothing
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

    await expect(P2POrdersDAL.matchOrders('b1', 's1'))
      .rejects.toThrow(/buy order b1 is not open/);

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    // Only BEGIN + UPDATE + ROLLBACK ran — no INSERT into p2p_order_matches
    const insertCalls = client.query.mock.calls.filter(([sql]) => /INSERT INTO p2p_order_matches/.test(sql));
    expect(insertCalls).toHaveLength(0);
    expect(client.release).toHaveBeenCalled();
  });

  test('sell order not open → throws descriptive error, ROLLBACK, no match insert', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ order_id: 'b1' }], rowCount: 1 }) // buy update ok
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // sell update matches nothing
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

    await expect(P2POrdersDAL.matchOrders('b1', 's1'))
      .rejects.toThrow(/sell order s1 is not open/);

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    const insertCalls = client.query.mock.calls.filter(([sql]) => /INSERT INTO p2p_order_matches/.test(sql));
    expect(insertCalls).toHaveLength(0);
  });
});
