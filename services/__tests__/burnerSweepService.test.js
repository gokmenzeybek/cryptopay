jest.mock('../../database/connection', () => ({
  pool: { query: jest.fn() }
}));

jest.mock('../../services/redisClient', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
}));

jest.mock('../../database/dal/p2pOrders', () => ({
  getBurnersForSweep: jest.fn()
}));

const P2POrdersDAL = require('../../database/dal/p2pOrders');
const burnerWalletService = require('../../services/burnerWalletService');
const { processBurnerSweep } = require('../burnerSweepService');

jest.mock('../../services/burnerWalletService', () => ({
  destroyBurner: jest.fn().mockResolvedValue(true)
}));

const BURNER_A = 'r' + 'a'.repeat(33);
const BURNER_B = 'r' + 'b'.repeat(33);
const BURNER_C = 'r' + 'c'.repeat(33);

describe('burnerSweepService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns zero counts when no burners to sweep', async () => {
    P2POrdersDAL.getBurnersForSweep.mockResolvedValue([]);

    const result = await processBurnerSweep();

    expect(result).toEqual({ processed: 0, destroyed: 0, errors: 0, skipped: 0 });
  });

  test('destroys burners and returns counts', async () => {
    const burners = [
      { address: BURNER_A, order_id: 'order-1' },
      { address: BURNER_B, order_id: 'order-2' },
      { address: BURNER_C, order_id: 'order-3' }
    ];
    P2POrdersDAL.getBurnersForSweep.mockResolvedValue(burners);
    burnerWalletService.destroyBurner.mockResolvedValue(true);

    const result = await processBurnerSweep();

    expect(result.processed).toBe(3);
    expect(result.destroyed).toBe(3);
    expect(result.errors).toBe(0);
    expect(burnerWalletService.destroyBurner).toHaveBeenCalledTimes(3);
  });

  test('skips already deleted burners', async () => {
    const burners = [
      { address: BURNER_A, order_id: 'order-1', deleted_at: '2024-01-01' },
      { address: BURNER_B, order_id: 'order-2' }
    ];
    P2POrdersDAL.getBurnersForSweep.mockResolvedValue(burners);
    burnerWalletService.destroyBurner.mockResolvedValue(true);

    const result = await processBurnerSweep();

    expect(result.skipped).toBe(1);
    expect(result.destroyed).toBe(1);
  });

  test('counts errors for failed destruction', async () => {
    const burners = [
      { address: BURNER_A, order_id: 'order-1' },
      { address: BURNER_B, order_id: 'order-2' }
    ];
    P2POrdersDAL.getBurnersForSweep.mockResolvedValue(burners);
    burnerWalletService.destroyBurner
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Failed'));

    const result = await processBurnerSweep();

    expect(result.destroyed).toBe(1);
    expect(result.errors).toBe(1);
  });
});
