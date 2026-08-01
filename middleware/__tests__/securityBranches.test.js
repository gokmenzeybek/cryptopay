/**
 * Branch coverage for middleware/security.js validator factories (PRD 7.1.3):
 * non-default field parameters, the payment-method Array.isArray ternary,
 * param/query validators, validateRequest both paths and sanitizeInput.
 */

const { validationResult } = require('express-validator');
const {
  validateRequest,
  validateXRPLAddress,
  validateTransactionHash,
  validateAmount,
  validateOrderType,
  validatePaymentMethod,
  validateOrderStatus,
  validateXRPLAddressParam,
  validateUUID,
  validatePagination,
  sanitizeInput
} = require('../security');

const runChains = async (chains, req) => {
  for (const chain of [].concat(chains)) {
    await chain.run(req);
  }
  return validationResult(req);
};

describe('security validator factories — branches', () => {
  test('validateXRPLAddress with a custom field name', async () => {
    const errors = await runChains(validateXRPLAddress('wallet'), { body: { wallet: 'bad' } });
    expect(errors.isEmpty()).toBe(false);
    const ok = await runChains(validateXRPLAddress('wallet'), {
      body: { wallet: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe' }
    });
    expect(ok.isEmpty()).toBe(true);
  });

  test('validateTransactionHash custom field', async () => {
    const bad = await runChains(validateTransactionHash('txHash'), { body: { txHash: 'xyz' } });
    expect(bad.isEmpty()).toBe(false);
    const ok = await runChains(validateTransactionHash('txHash'), {
      body: { txHash: 'A'.repeat(64) }
    });
    expect(ok.isEmpty()).toBe(true);
  });

  test('validateAmount with custom field and minimum', async () => {
    const bad = await runChains(validateAmount('xrpAmount', 1), { body: { xrpAmount: 0.5 } });
    expect(bad.isEmpty()).toBe(false);
    const ok = await runChains(validateAmount('xrpAmount', 1), { body: { xrpAmount: 5 } });
    expect(ok.isEmpty()).toBe(true);
  });

  test('validateOrderType buy/sell only', async () => {
    expect((await runChains(validateOrderType(), { body: { type: 'buy' } })).isEmpty()).toBe(true);
    expect((await runChains(validateOrderType(), { body: { type: 'hold' } })).isEmpty()).toBe(false);
  });

  test('validatePaymentMethod accepts an array of valid methods', async () => {
    const ok = await runChains(validatePaymentMethod(), {
      body: { paymentMethods: ['papara', 'ininal'] }
    });
    expect(ok.isEmpty()).toBe(true);
  });

  test('validatePaymentMethod accepts a single string (non-array branch)', async () => {
    const ok = await runChains(validatePaymentMethod(), { body: { paymentMethods: 'mefete' } });
    expect(ok.isEmpty()).toBe(true);
  });

  test('validatePaymentMethod rejects unknown methods', async () => {
    const bad = await runChains(validatePaymentMethod(), {
      body: { paymentMethods: ['papara', 'bitcoin'] }
    });
    expect(bad.isEmpty()).toBe(false);
  });

  test('validateOrderStatus accepts known statuses only', async () => {
    expect((await runChains(validateOrderStatus(), { body: { status: 'MATCHED' } })).isEmpty()).toBe(true);
    expect((await runChains(validateOrderStatus(), { body: { status: 'pending' } })).isEmpty()).toBe(false);
  });

  test('validateXRPLAddressParam validates route params', async () => {
    const bad = await runChains(validateXRPLAddressParam(), { params: { address: 'nope' } });
    expect(bad.isEmpty()).toBe(false);
    const ok = await runChains(validateXRPLAddressParam('owner'), {
      params: { owner: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe' }
    });
    expect(ok.isEmpty()).toBe(true);
  });

  test('validateUUID validates param UUIDs', async () => {
    const bad = await runChains(validateUUID(), { params: { id: 'not-a-uuid' } });
    expect(bad.isEmpty()).toBe(false);
    const ok = await runChains(validateUUID('requestId'), {
      params: { requestId: '123e4567-e89b-12d3-a456-426614174000' }
    });
    expect(ok.isEmpty()).toBe(true);
  });

  test('validatePagination enforces limit and offset bounds', async () => {
    const chains = validatePagination();
    expect((await runChains(chains, { query: { limit: '50', offset: '10' } })).isEmpty()).toBe(true);
    expect((await runChains(validatePagination(), { query: { limit: '500' } })).isEmpty()).toBe(false);
    expect((await runChains(validatePagination(), { query: { offset: '-1' } })).isEmpty()).toBe(false);
    expect((await runChains(validatePagination(), { query: {} })).isEmpty()).toBe(true);
  });

  test('validateRequest passes clean requests and rejects invalid ones', async () => {
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    validateRequest({ body: {} }, res, next);
    expect(next).toHaveBeenCalled();

    const req = { body: { type: 'hold' } };
    await validateOrderType().run(req);
    validateRequest(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('sanitizeInput strips script tags, javascript: URLs and event handlers', () => {
    const next = jest.fn();
    const req = {
      body: {
        name: '<script>alert(1)</script>Alice',
        url: 'javascript:alert(1)',
        click: 'onclick=hack()',
        count: 42
      },
      query: { q: '<script>x</script>hi', page: 2 }
    };
    sanitizeInput(req, {}, next);
    expect(req.body.name).toBe('Alice');
    expect(req.body.url).toBe('alert(1)');
    expect(req.body.click).toBe('hack()');
    expect(req.body.count).toBe(42);
    expect(req.query.q).toBe('hi');
    expect(req.query.page).toBe(2);
    expect(next).toHaveBeenCalled();
  });

  test('sanitizeInput tolerates missing body/query', () => {
    const next = jest.fn();
    sanitizeInput({}, {}, next);
    expect(next).toHaveBeenCalled();
  });
});
