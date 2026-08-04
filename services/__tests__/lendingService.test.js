/**
 * Unit tests for lendingService (platform as XRP reserve)
 */

const { generateSeed, deriveKeypair, deriveAddress } = require('ripple-keypairs');

// Dynamically generate mock addresses (no hardcoded wallet addresses)
const mockReserveKeypair = deriveKeypair(generateSeed());
const mockReserveAddress = deriveAddress(mockReserveKeypair.publicKey);

const mockSellerKeypair = deriveKeypair(generateSeed());
const mockSellerAddress = deriveAddress(mockSellerKeypair.publicKey);

const mockBuyerKeypair = deriveKeypair(generateSeed());
const mockBuyerAddress = deriveAddress(mockBuyerKeypair.publicKey);

jest.mock('../../database/connection', () => ({
  pool: {
    query: jest.fn()
  }
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  logP2P: jest.fn()
}));

const { pool } = require('../../database/connection');
const lendingService = require('../lendingService');

describe('lendingService.computeCut', () => {
  beforeEach(() => {
    delete process.env.RESERVE_CUT_PERCENT;
  });

  test('takes a 2.5% cut on TRY by default', () => {
    const result = lendingService.computeCut(3000);
    expect(result.grossTry).toBe(3000);
    expect(result.cutTry).toBe(75);
    expect(result.sellerPayoutTry).toBe(2925);
    expect(result.cutPercent).toBe(0.025);
  });

  test('honors RESERVE_CUT_PERCENT override', () => {
    process.env.RESERVE_CUT_PERCENT = '0.05';
    const result = lendingService.computeCut(1000);
    expect(result.cutTry).toBe(50);
    expect(result.sellerPayoutTry).toBe(950);
  });

  test('rounds to 2 decimal places', () => {
    const result = lendingService.computeCut(99.999);
    expect(result.cutTry).toBe(2.5);
    expect(result.sellerPayoutTry).toBe(97.5);
  });
});

describe('lendingService.escrowSource', () => {
  beforeEach(() => {
    delete process.env.RESERVE_ADDRESS;
  });

  test('returns the reserve when configured and allowed', () => {
    process.env.RESERVE_ADDRESS = mockReserveAddress;
    const order = { order_type: 'sell', xrpl_address: mockSellerAddress };
    expect(lendingService.escrowSource(order)).toBe(mockReserveAddress);
  });

  test('falls back to the seller when the reserve is disabled', () => {
    const order = { order_type: 'sell', xrpl_address: mockSellerAddress, counterparty_address: mockBuyerAddress };
    expect(lendingService.escrowSource(order)).toBe(mockSellerAddress);
  });

  test('reserve is opt-in per call', () => {
    process.env.RESERVE_ADDRESS = mockReserveAddress;
    const order = { order_type: 'sell', xrpl_address: mockSellerAddress };
    expect(lendingService.escrowSource(order, { allowReserve: false })).toBe(mockSellerAddress);
  });
});

describe('lendingService credit ledger', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  test('authorizeLend allows within the credit limit', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ credit_limit_xrp: '100', outstanding_xrp: '40' }]
    });
    const result = await lendingService.authorizeLend(mockSellerAddress, 50);
    expect(result.approved).toBe(true);
    expect(result.limitXrp).toBe(100);
    expect(result.outstandingXrp).toBe(40);
  });

  test('authorizeLend rejects when credit is exhausted', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ credit_limit_xrp: '100', outstanding_xrp: '90' }]
    });
    await expect(lendingService.authorizeLend(mockSellerAddress, 20))
      .rejects.toThrow(/credit exhausted/);
  });

  test('reserveLend upserts outstanding', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await lendingService.reserveLend(mockSellerAddress, 25);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('reserve_credit');
    expect(params).toEqual([mockSellerAddress, 25]);
  });

  test('releaseLend never goes negative', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await lendingService.releaseLend(mockSellerAddress, 999);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain('GREATEST(outstanding_xrp - $2, 0)');
  });
});

describe('lendingService.recordSettlement', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'settlement-uuid',
        order_id: 'buy_1',
        seller_address: mockSellerAddress,
        gross_try: '3000.00',
        cut_try: '75.00',
        cut_percent: '0.0250',
        lent_xrp: '100.000000',
        seller_payout_try: '2925.00',
        status: 'pending'
      }]
    }).mockResolvedValueOnce({ rows: [] }); // releaseLend
  });

  test('records cut and reconciles the lend back to the reserve', async () => {
    const settlement = await lendingService.recordSettlement({
      orderId: 'buy_1',
      sellerAddress: mockSellerAddress,
      grossTry: 3000,
      lentXrp: 100
    });

    expect(settlement.cut_try).toBe('75.00');
    expect(settlement.seller_payout_try).toBe('2925.00');
    // releaseLend called second
    const releaseCall = pool.query.mock.calls[1];
    expect(releaseCall[1]).toEqual([mockSellerAddress, 100]);
  });
});
