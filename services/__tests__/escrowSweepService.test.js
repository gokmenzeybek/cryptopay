jest.mock('../../database/connection', () => ({
  pool: { query: jest.fn() }
}));

jest.mock('../../services/redisClient', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
}));

jest.mock('../../database/dal/p2pOrders', () => ({
  getExpiredLockedEscrows: jest.fn(),
  updateEscrow: jest.fn(),
  updateOrderStatus: jest.fn()
}));

jest.mock('../../services/eventBus', () => ({
  EVENTS: { ORDER_CANCELLED: 'order:cancelled' },
  emit: jest.fn()
}));

const P2POrdersDAL = require('../../database/dal/p2pOrders');
const xrplVerificationService = require('../../services/xrplVerificationService');
const xrplClientService = require('../../services/xrplClientService');
const { processEscrowSweep } = require('../escrowSweepService');

jest.mock('../../services/xrplVerificationService', () => ({
  escrowExistsOnLedger: jest.fn()
}));

jest.mock('../../services/xrplClientService', () => ({
  getClient: jest.fn().mockResolvedValue({ isConnected: () => true, request: jest.fn() })
}));

const ESCROW_OWNER_A = 'r' + 'a'.repeat(33);
const ESCROW_OWNER_B = 'r' + 'b'.repeat(33);

describe('escrowSweepService', () => {
  beforeEach(() => {
    P2POrdersDAL.getExpiredLockedEscrows.mockClear();
    P2POrdersDAL.updateEscrow.mockClear();
    P2POrdersDAL.updateOrderStatus.mockClear();
    xrplVerificationService.escrowExistsOnLedger.mockClear();
    xrplClientService.getClient.mockClear();
  });

  test('returns zero counts when no expired escrows', async () => {
    P2POrdersDAL.getExpiredLockedEscrows.mockResolvedValue([]);

    const result = await processEscrowSweep();

    expect(result).toEqual({ processed: 0, expired: 0, errors: 0 });
  });

  test('processes expired escrows when escrow still on ledger', async () => {
    const expiredOrders = [
      { id: 1, order_id: 'order-1', escrow_owner: ESCROW_OWNER_A, escrow_transaction_hash: 'hash1' },
      { id: 2, order_id: 'order-2', escrow_owner: ESCROW_OWNER_B, escrow_transaction_hash: 'hash2' }
    ];
    P2POrdersDAL.getExpiredLockedEscrows.mockResolvedValue(expiredOrders);
    xrplVerificationService.escrowExistsOnLedger.mockResolvedValue(true);

    const result = await processEscrowSweep();

    expect(result.processed).toBe(2);
    expect(result.expired).toBe(2);
    expect(result.errors).toBe(0);
    expect(P2POrdersDAL.updateOrderStatus).toHaveBeenCalledTimes(2);
  });

  test('marks escrow as completed_on_chain when not on ledger', async () => {
    const expiredOrders = [
      { id: 1, order_id: 'order-1', escrow_owner: ESCROW_OWNER_A, escrow_transaction_hash: 'hash1' }
    ];
    P2POrdersDAL.getExpiredLockedEscrows.mockResolvedValue(expiredOrders);
    xrplVerificationService.escrowExistsOnLedger.mockResolvedValue(false);

    const result = await processEscrowSweep();

    expect(result.processed).toBe(1);
    expect(result.expired).toBe(1);
    expect(result.errors).toBe(0);
    expect(P2POrdersDAL.updateEscrow).toHaveBeenCalledTimes(1);
    expect(P2POrdersDAL.updateEscrow).toHaveBeenCalledWith(1, { escrow_status: 'completed_on_chain' });
    expect(P2POrdersDAL.updateOrderStatus).not.toHaveBeenCalled();
  });

  test('updates order status to expired when escrow still on ledger', async () => {
    const expiredOrders = [
      { id: 1, order_id: 'order-1', escrow_owner: ESCROW_OWNER_A, escrow_transaction_hash: 'hash1' }
    ];
    P2POrdersDAL.getExpiredLockedEscrows.mockResolvedValue(expiredOrders);
    xrplVerificationService.escrowExistsOnLedger.mockResolvedValue(true);

    const before = Date.now();
    const result = await processEscrowSweep();
    const after = Date.now();

    expect(result.processed).toBe(1);
    expect(result.expired).toBe(1);
    expect(result.errors).toBe(0);

    expect(P2POrdersDAL.updateOrderStatus).toHaveBeenCalledTimes(1);
    const [orderId, status, extras] = P2POrdersDAL.updateOrderStatus.mock.calls[0];
    expect(orderId).toBe(1);
    expect(status).toBe('expired');
    expect(extras.expired_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const expiredTime = new Date(extras.expired_at).getTime();
    expect(expiredTime).toBeGreaterThanOrEqual(before);
    expect(expiredTime).toBeLessThanOrEqual(after);
  });

  test('counts errors for failed processing', async () => {
    const expiredOrders = [
      { id: 1, order_id: 'order-1', escrow_owner: ESCROW_OWNER_A, escrow_transaction_hash: 'hash1' }
    ];
    P2POrdersDAL.getExpiredLockedEscrows.mockResolvedValue(expiredOrders);
    xrplVerificationService.escrowExistsOnLedger.mockRejectedValue(new Error('XRPL down'));

    const result = await processEscrowSweep();

    expect(result.processed).toBe(1);
    expect(result.expired).toBe(0);
    expect(result.errors).toBe(1);
    expect(P2POrdersDAL.updateEscrow).not.toHaveBeenCalled();
    expect(P2POrdersDAL.updateOrderStatus).not.toHaveBeenCalled();
  });
});
