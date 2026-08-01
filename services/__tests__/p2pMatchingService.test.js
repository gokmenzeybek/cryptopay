/**
 * Unit Tests for P2P Matching Service
 */

const p2pMatchingService = require('../p2pMatchingService');
const xrplVerificationService = require('../xrplVerificationService');

jest.mock('../xrplVerificationService');

describe('P2P Matching Service', () => {
  describe('Constants', () => {
    it('should have correct order types', () => {
      expect(p2pMatchingService.ORDER_TYPE.BUY).toBe('buy');
      expect(p2pMatchingService.ORDER_TYPE.SELL).toBe('sell');
    });

    it('should have correct order statuses', () => {
      expect(p2pMatchingService.ORDER_STATUS.OPEN).toBe('open');
      expect(p2pMatchingService.ORDER_STATUS.MATCHED).toBe('matched');
      expect(p2pMatchingService.ORDER_STATUS.PAYMENT_CONFIRMED).toBe('payment_confirmed');
      expect(p2pMatchingService.ORDER_STATUS.COMPLETED).toBe('completed');
      expect(p2pMatchingService.ORDER_STATUS.CANCELLED).toBe('cancelled');
      expect(p2pMatchingService.ORDER_STATUS.DISPUTED).toBe('disputed');
      expect(p2pMatchingService.ORDER_STATUS.EXPIRED).toBe('expired');
    });

    it('should have correct payment methods', () => {
      expect(p2pMatchingService.PAYMENT_METHODS.BANK_TRANSFER).toBe('bank_transfer');
      expect(p2pMatchingService.PAYMENT_METHODS.PAPARA).toBe('papara');
      expect(p2pMatchingService.PAYMENT_METHODS.ININAL).toBe('ininal');
      expect(p2pMatchingService.PAYMENT_METHODS.MEFETE).toBe('mefete');
      expect(p2pMatchingService.PAYMENT_METHODS.QR_HAVALE).toBe('qr_havale');
    });
  });

  describe('createP2POrder', () => {
    it('should create a buy order correctly', () => {
      const orderData = {
        type: 'buy',
        tryAmount: 100,
        xrpAmount: 10,
        rate: 10,
        xrplAddress: 'rTest1234567890123456789012345678901234',
        paymentMethods: ['bank_transfer'],
        timeLimit: 30,
        metadata: { name: 'Test User' }
      };

      const order = p2pMatchingService.createP2POrder(orderData);

      expect(order).toMatchObject({
        type: 'buy',
        status: 'open',
        tryAmount: 100,
        xrpAmount: 10,
        rate: 10,
        xrplAddress: 'rTest1234567890123456789012345678901234',
        paymentMethods: ['bank_transfer'],
        timeLimitMinutes: 30,
        metadata: { name: 'Test User' }
      });
      expect(order.id).toMatch(/^buy_/);
      expect(order.createdAt).toBeDefined();
      expect(order.expiresAt).toBeDefined();
    });

    it('should create a sell order correctly', () => {
      const orderData = {
        type: 'sell',
        tryAmount: 200,
        xrpAmount: 20,
        rate: 10,
        xrplAddress: 'rTest9876543210987654321098765432109876',
        paymentMethods: ['papara', 'ininal']
      };

      const order = p2pMatchingService.createP2POrder(orderData);

      expect(order).toMatchObject({
        type: 'sell',
        status: 'open',
        tryAmount: 200,
        xrpAmount: 20,
        rate: 10,
        xrplAddress: 'rTest9876543210987654321098765432109876',
        paymentMethods: ['papara', 'ininal']
      });
      expect(order.id).toMatch(/^sell_/);
    });

    it('should handle single payment method as array', () => {
      const orderData = {
        type: 'buy',
        tryAmount: 100,
        xrpAmount: 10,
        rate: 10,
        xrplAddress: 'rTest1234567890123456789012345678901234',
        paymentMethods: 'bank_transfer'
      };

      const order = p2pMatchingService.createP2POrder(orderData);

      expect(order.paymentMethods).toEqual(['bank_transfer']);
    });

    it('should set default time limit', () => {
      const orderData = {
        type: 'buy',
        tryAmount: 100,
        xrpAmount: 10,
        rate: 10,
        xrplAddress: 'rTest1234567890123456789012345678901234',
        paymentMethods: ['bank_transfer']
      };

      const order = p2pMatchingService.createP2POrder(orderData);

      expect(order.timeLimitMinutes).toBe(30);
    });
  });

  describe('findMatchingOrders', () => {
    const buyOrder = {
      type: 'buy',
      tryAmount: 100,
      rate: 10,
      xrplAddress: 'rBuyer1234567890123456789012345678901234',
      paymentMethods: ['bank_transfer']
    };

    const sellOrder1 = {
      type: 'sell',
      tryAmount: 100,
      rate: 9.5,
      xrplAddress: 'rSeller1234567890123456789012345678901234',
      paymentMethods: ['bank_transfer'],
      status: 'open',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      rating: 5,
      completedTrades: 10
    };

    const sellOrder2 = {
      type: 'sell',
      tryAmount: 100,
      rate: 9.0,
      xrplAddress: 'rSeller2987654321098765432109876543210987',
      paymentMethods: ['bank_transfer'],
      status: 'open',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      rating: 4,
      completedTrades: 5
    };

    const sellOrder3 = {
      type: 'sell',
      tryAmount: 100,
      rate: 10.5,
      xrplAddress: 'rSeller3987654321098765432109876543210987',
      paymentMethods: ['bank_transfer'],
      status: 'open',
      expiresAt: new Date(Date.now() + 60000).toISOString()
    };

    it('should find compatible sell orders for buy order', () => {
      const allOrders = [sellOrder1, sellOrder2, sellOrder3];
      const matches = p2pMatchingService.findMatchingOrders(buyOrder, allOrders);

      expect(matches).toHaveLength(2);
      expect(matches[0]).toEqual(sellOrder1); // Higher rating (5)
      expect(matches[1]).toEqual(sellOrder2); // Lower rating (4)
    });

    it('should not match orders with incompatible rates', () => {
      const allOrders = [sellOrder3]; // Rate 10.5 > buyer's 10
      const matches = p2pMatchingService.findMatchingOrders(buyOrder, allOrders);

      expect(matches).toHaveLength(0);
    });

    it('should not match orders with different payment methods', () => {
      const incompatibleOrder = {
        ...sellOrder1,
        paymentMethods: ['papara']
      };
      const allOrders = [incompatibleOrder];
      const matches = p2pMatchingService.findMatchingOrders(buyOrder, allOrders);

      expect(matches).toHaveLength(0);
    });

    it('should not match own orders', () => {
      const ownOrder = {
        ...sellOrder1,
        xrplAddress: buyOrder.xrplAddress
      };
      const allOrders = [ownOrder];
      const matches = p2pMatchingService.findMatchingOrders(buyOrder, allOrders);

      expect(matches).toHaveLength(0);
    });

    it('should not match expired orders', () => {
      const expiredOrder = {
        ...sellOrder1,
        expiresAt: new Date(Date.now() - 60000).toISOString()
      };
      const allOrders = [expiredOrder];
      const matches = p2pMatchingService.findMatchingOrders(buyOrder, allOrders);

      expect(matches).toHaveLength(0);
    });

    it('should not match non-open orders', () => {
      const matchedOrder = {
        ...sellOrder1,
        status: 'matched'
      };
      const allOrders = [matchedOrder];
      const matches = p2pMatchingService.findMatchingOrders(buyOrder, allOrders);

      expect(matches).toHaveLength(0);
    });

    it('should prioritize by rating and completed trades', () => {
      const allOrders = [sellOrder2, sellOrder1]; // sellOrder1 has better rating
      const matches = p2pMatchingService.findMatchingOrders(buyOrder, allOrders);

      expect(matches[0]).toEqual(sellOrder1); // Higher rating first
      expect(matches[1]).toEqual(sellOrder2);
    });
  });

  describe('matchOrders', () => {
    const buyOrder = {
      type: 'buy',
      status: 'open',
      tryAmount: 100,
      rate: 10,
      xrplAddress: 'rBuyer1234567890123456789012345678901234',
      paymentMethods: ['bank_transfer', 'papara']
    };

    const sellOrder = {
      type: 'sell',
      status: 'open',
      tryAmount: 120,
      rate: 9.5,
      xrplAddress: 'rSeller1234567890123456789012345678901234',
      paymentMethods: ['bank_transfer', 'ininal']
    };

    it('should match two orders correctly', () => {
      const result = p2pMatchingService.matchOrders(buyOrder, sellOrder);

      expect(result.order1.status).toBe('matched');
      expect(result.order1.matchedOrderId).toBe(sellOrder.id);
      expect(result.order1.counterpartyAddress).toBe(sellOrder.xrplAddress);
      expect(result.order1.counterpartyPaymentMethod).toBe('bank_transfer');

      expect(result.order2.status).toBe('matched');
      expect(result.order2.matchedOrderId).toBe(buyOrder.id);
      expect(result.order2.counterpartyAddress).toBe(buyOrder.xrplAddress);
      expect(result.order2.counterpartyPaymentMethod).toBe('bank_transfer');

      expect(result.match).toEqual({
        tryAmount: 100, // Minimum of both
        xrpAmount: 100 / 10, // tryAmount / buyer's rate
        rate: 10, // Buyer's rate
        paymentMethod: 'bank_transfer'
      });
    });
  });

  describe('confirmPayment', () => {
    it('should confirm payment for matched order', async () => {
      const order = {
        status: 'matched',
        id: 'test_order_123'
      };

      const result = await p2pMatchingService.confirmPayment(order, 'proof123');

      expect(result.status).toBe('payment_confirmed');
      expect(result.paymentConfirmedAt).toBeDefined();
      expect(result.proofOfPayment).toBe('proof123');
    });

    it('should throw error for non-matched order', async () => {
      const order = {
        status: 'open',
        id: 'test_order_123'
      };

      await expect(
        p2pMatchingService.confirmPayment(order, 'proof123')
      ).rejects.toThrow('Cannot confirm payment for order in status: open');
    });
  });

  describe('confirmXrpTransfer', () => {
    const mockClient = { request: jest.fn() };

    beforeEach(() => {
      xrplVerificationService.verifyPayment.mockReset();
    });

    it('should confirm XRP transfer for payment confirmed order when verified on-chain', async () => {
      xrplVerificationService.verifyPayment.mockResolvedValue({ verified: true });

      const order = {
        status: 'payment_confirmed',
        type: 'buy',
        id: 'test_order_123',
        xrplAddress: 'rBuyer1234567890123456789012345678901234',
        xrpAmount: 10
      };

      const result = await p2pMatchingService.confirmXrpTransfer(order, 'a'.repeat(64), mockClient);

      expect(result.status).toBe('completed');
      expect(result.xrpTransactionHash).toBe('a'.repeat(64));
      expect(result.xrpConfirmedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
      expect(xrplVerificationService.verifyPayment).toHaveBeenCalledWith(mockClient, {
        hash: 'a'.repeat(64),
        expectedDestination: 'rBuyer1234567890123456789012345678901234',
        minAmountXrp: 10
      });
    });

    it('should throw error for non-payment confirmed order', async () => {
      const order = {
        status: 'matched',
        type: 'buy',
        id: 'test_order_123',
        xrplAddress: 'rBuyer1234567890123456789012345678901234',
        xrpAmount: 10
      };

      await expect(
        p2pMatchingService.confirmXrpTransfer(order, 'a'.repeat(64), mockClient)
      ).rejects.toThrow('Cannot confirm XRP for order in status: matched');
      expect(xrplVerificationService.verifyPayment).not.toHaveBeenCalled();
    });

    it('should throw when on-chain verification fails', async () => {
      xrplVerificationService.verifyPayment.mockResolvedValue({
        verified: false,
        reason: 'Transaction not found on ledger'
      });

      const order = {
        status: 'payment_confirmed',
        type: 'sell',
        id: 'test_order_123',
        xrplAddress: 'rSeller1234567890123456789012345678901234',
        counterpartyAddress: 'rBuyer1234567890123456789012345678901234',
        xrpAmount: 10
      };

      await expect(
        p2pMatchingService.confirmXrpTransfer(order, 'a'.repeat(64), mockClient)
      ).rejects.toThrow('XRP transfer verification failed: Transaction not found on ledger');
      expect(order.status).toBe('payment_confirmed');
    });

    it('should throw when XRPL client is missing', async () => {
      const order = {
        status: 'payment_confirmed',
        type: 'buy',
        id: 'test_order_123',
        xrplAddress: 'rBuyer1234567890123456789012345678901234',
        xrpAmount: 10
      };

      await expect(
        p2pMatchingService.confirmXrpTransfer(order, 'a'.repeat(64), undefined)
      ).rejects.toThrow('XRPL client is required for on-chain verification');
    });

    it('should use finalXrpAmount when available', async () => {
      xrplVerificationService.verifyPayment.mockResolvedValue({ verified: true });

      const order = {
        status: 'payment_confirmed',
        type: 'buy',
        id: 'test_order_123',
        xrplAddress: 'rBuyer1234567890123456789012345678901234',
        xrpAmount: 20,
        finalXrpAmount: 10
      };

      await p2pMatchingService.confirmXrpTransfer(order, 'a'.repeat(64), mockClient);

      expect(xrplVerificationService.verifyPayment).toHaveBeenCalledWith(mockClient, {
        hash: 'a'.repeat(64),
        expectedDestination: 'rBuyer1234567890123456789012345678901234',
        minAmountXrp: 10
      });
    });
  });

  describe('lockEscrowForOrder', () => {
    const mockClient = { request: jest.fn() };

    const sellOrder = () => ({
      status: 'matched',
      type: 'sell',
      id: 'test_order_123',
      xrplAddress: 'rSeller1234567890123456789012345678901234',
      counterpartyAddress: 'rBuyer1234567890123456789012345678901234',
      xrpAmount: 10,
      escrow_status: 'prepared',
      escrow_condition: 'A'.repeat(64)
    });

    beforeEach(() => {
      xrplVerificationService.verifyEscrowCreate.mockReset();
    });

    it('should lock escrow when the seller submits a verified EscrowCreate hash', async () => {
      xrplVerificationService.verifyEscrowCreate.mockResolvedValue({ verified: true });

      const order = sellOrder();
      const result = await p2pMatchingService.lockEscrowForOrder(order, {
        txHash: 'b'.repeat(64),
        offerSequence: 42,
        callerAddress: 'rSeller1234567890123456789012345678901234'
      }, mockClient);

      expect(result).toBe(order);
      expect(xrplVerificationService.verifyEscrowCreate).toHaveBeenCalledWith(mockClient, {
        hash: 'b'.repeat(64),
        expectedOwner: 'rSeller1234567890123456789012345678901234',
        expectedDestination: 'rBuyer1234567890123456789012345678901234',
        expectedAmountXrp: 10,
        expectedCondition: 'A'.repeat(64),
        expectedSequence: 42
      });
    });

    it('should reject with 403 when the buyer submits the hash', async () => {
      const order = sellOrder();

      await expect(
        p2pMatchingService.lockEscrowForOrder(order, {
          txHash: 'b'.repeat(64),
          offerSequence: 42,
          callerAddress: 'rBuyer1234567890123456789012345678901234'
        }, mockClient)
      ).rejects.toMatchObject({
        message: 'Only the seller (escrow owner) can submit the escrow hash',
        statusCode: 403
      });
      expect(xrplVerificationService.verifyEscrowCreate).not.toHaveBeenCalled();
    });

    it('should reject an unverified hash without changing order state', async () => {
      xrplVerificationService.verifyEscrowCreate.mockResolvedValue({
        verified: false,
        reason: 'Condition mismatch: expected AAAA, got BBBB'
      });

      const order = sellOrder();

      await expect(
        p2pMatchingService.lockEscrowForOrder(order, {
          txHash: 'b'.repeat(64),
          offerSequence: 42,
          callerAddress: 'rSeller1234567890123456789012345678901234'
        }, mockClient)
      ).rejects.toThrow('Escrow verification failed: Condition mismatch');
      expect(order.escrow_status).toBe('prepared');
    });

    it('should reject a non-positive offerSequence', async () => {
      const order = sellOrder();

      await expect(
        p2pMatchingService.lockEscrowForOrder(order, {
          txHash: 'b'.repeat(64),
          offerSequence: 0,
          callerAddress: 'rSeller1234567890123456789012345678901234'
        }, mockClient)
      ).rejects.toThrow('offerSequence must be a positive integer');
      expect(xrplVerificationService.verifyEscrowCreate).not.toHaveBeenCalled();
    });

    it('should reject when no escrow condition was prepared', async () => {
      const order = sellOrder();
      delete order.escrow_condition;

      await expect(
        p2pMatchingService.lockEscrowForOrder(order, {
          txHash: 'b'.repeat(64),
          offerSequence: 42,
          callerAddress: 'rSeller1234567890123456789012345678901234'
        }, mockClient)
      ).rejects.toThrow('No escrow condition recorded for this order');
    });

    it('should reject when escrow is already finished', async () => {
      const order = sellOrder();
      order.escrow_status = 'finished';

      await expect(
        p2pMatchingService.lockEscrowForOrder(order, {
          txHash: 'b'.repeat(64),
          offerSequence: 42,
          callerAddress: 'rSeller1234567890123456789012345678901234'
        }, mockClient)
      ).rejects.toThrow('Escrow already finished');
    });

    it('should use finalXrpAmount when available and treat buy-order creator as buyer', async () => {
      xrplVerificationService.verifyEscrowCreate.mockResolvedValue({ verified: true });

      const order = {
        status: 'matched',
        type: 'buy',
        id: 'test_order_123',
        xrplAddress: 'rBuyer1234567890123456789012345678901234',
        counterpartyAddress: 'rSeller1234567890123456789012345678901234',
        xrpAmount: 20,
        finalXrpAmount: 10,
        escrow_status: 'prepared',
        escrow_condition: 'C'.repeat(64)
      };

      await p2pMatchingService.lockEscrowForOrder(order, {
        txHash: 'b'.repeat(64),
        offerSequence: 7,
        callerAddress: 'rSeller1234567890123456789012345678901234'
      }, mockClient);

      expect(xrplVerificationService.verifyEscrowCreate).toHaveBeenCalledWith(mockClient, {
        hash: 'b'.repeat(64),
        expectedOwner: 'rSeller1234567890123456789012345678901234',
        expectedDestination: 'rBuyer1234567890123456789012345678901234',
        expectedAmountXrp: 10,
        expectedCondition: 'C'.repeat(64),
        expectedSequence: 7
      });
    });
  });

  describe('confirmEscrowCompletion', () => {
    const mockClient = { request: jest.fn() };

    const pendingOrder = (escrowStatus) => ({
      status: 'completed',
      type: 'sell',
      id: 'test_order_123',
      xrplAddress: 'rSeller1234567890123456789012345678901234',
      counterpartyAddress: 'rBuyer1234567890123456789012345678901234',
      xrpAmount: 10,
      escrow_status: escrowStatus,
      escrow_owner: 'rSeller1234567890123456789012345678901234',
      escrow_sequence: 42
    });

    beforeEach(() => {
      xrplVerificationService.verifyEscrowCompletion.mockReset();
    });

    it('should return finished when a finish_pending escrow verifies an EscrowFinish', async () => {
      xrplVerificationService.verifyEscrowCompletion.mockResolvedValue({ verified: true });

      const result = await p2pMatchingService.confirmEscrowCompletion(
        pendingOrder('finish_pending'), 'c'.repeat(64),
        'rBuyer1234567890123456789012345678901234', mockClient
      );

      expect(result.escrowStatus).toBe('finished');
      expect(xrplVerificationService.verifyEscrowCompletion).toHaveBeenCalledWith(mockClient, {
        hash: 'c'.repeat(64),
        expectedType: 'EscrowFinish',
        expectedOwner: 'rSeller1234567890123456789012345678901234',
        expectedOfferSequence: 42
      });
    });

    it('should return refunded when a refund_pending escrow verifies an EscrowCancel', async () => {
      xrplVerificationService.verifyEscrowCompletion.mockResolvedValue({ verified: true });

      const result = await p2pMatchingService.confirmEscrowCompletion(
        pendingOrder('refund_pending'), 'c'.repeat(64),
        'rSeller1234567890123456789012345678901234', mockClient
      );

      expect(result.escrowStatus).toBe('refunded');
      expect(xrplVerificationService.verifyEscrowCompletion).toHaveBeenCalledWith(mockClient, {
        hash: 'c'.repeat(64),
        expectedType: 'EscrowCancel',
        expectedOwner: 'rSeller1234567890123456789012345678901234',
        expectedOfferSequence: 42
      });
    });

    it('should reject an invalid hash without changing order state', async () => {
      xrplVerificationService.verifyEscrowCompletion.mockResolvedValue({
        verified: false,
        reason: 'Transaction not found on ledger'
      });

      const order = pendingOrder('finish_pending');

      await expect(
        p2pMatchingService.confirmEscrowCompletion(
          order, 'c'.repeat(64),
          'rSeller1234567890123456789012345678901234', mockClient
        )
      ).rejects.toThrow('Escrow completion verification failed: Transaction not found on ledger');
      expect(order.escrow_status).toBe('finish_pending');
    });

    it('should reject when the escrow is not pending completion', async () => {
      await expect(
        p2pMatchingService.confirmEscrowCompletion(
          pendingOrder('locked'), 'c'.repeat(64),
          'rSeller1234567890123456789012345678901234', mockClient
        )
      ).rejects.toThrow('Escrow is not pending completion');
      expect(xrplVerificationService.verifyEscrowCompletion).not.toHaveBeenCalled();
    });

    it('should reject with 403 for non-participants', async () => {
      await expect(
        p2pMatchingService.confirmEscrowCompletion(
          pendingOrder('finish_pending'), 'c'.repeat(64),
          'rStranger1234567890123456789012345678901', mockClient
        )
      ).rejects.toMatchObject({
        message: 'Only trade participants can confirm escrow completion',
        statusCode: 403
      });
      expect(xrplVerificationService.verifyEscrowCompletion).not.toHaveBeenCalled();
    });
  });

  describe('cancelMatchedOrder rules (PRD 3.2.1)', () => {
    it('should reject cancellation while escrow is locked on-chain', () => {
      const order = {
        status: 'matched',
        escrow_status: 'locked'
      };

      expect(() => p2pMatchingService.cancelMatchedOrder(order, 'mutual agreement'))
        .toThrow(/locked on-chain — open a dispute instead/);
      expect(order.status).toBe('matched'); // unchanged
    });

    it('should reject cancellation from payment_confirmed and point to disputes', () => {
      const order = {
        status: 'payment_confirmed',
        escrow_status: 'none'
      };

      expect(() => p2pMatchingService.cancelMatchedOrder(order, 'changed my mind'))
        .toThrow(/Cannot cancel after payment is confirmed — open a dispute instead/);
      expect(order.status).toBe('payment_confirmed'); // unchanged
    });

    it('should cancel a matched order when no escrow is locked', () => {
      const order = {
        status: 'matched',
        escrow_status: 'none'
      };

      const result = p2pMatchingService.cancelMatchedOrder(order, 'mutual agreement');

      expect(result.status).toBe('cancelled');
      expect(result.escrowStatus).toBeUndefined();
    });

    it('should reject cancellation from terminal or unrelated states', () => {
      expect(() => p2pMatchingService.cancelMatchedOrder({ status: 'completed' }, 'x'))
        .toThrow(/Cannot cancel matched order in status: completed/);
      expect(() => p2pMatchingService.cancelMatchedOrder({ status: 'open' }, 'x'))
        .toThrow(/Cannot cancel matched order in status: open/);
    });
  });

  describe('classifyExpiredEscrow', () => {
    const mockClient = { request: jest.fn() };

    const expiredOrder = () => ({
      order_id: 'test_order_123',
      escrow_status: 'locked',
      escrow_owner: 'rSeller1234567890123456789012345678901234',
      escrow_transaction_hash: 'd'.repeat(64)
    });

    beforeEach(() => {
      xrplVerificationService.escrowExistsOnLedger.mockReset();
    });

    it('should classify as cancelled when the escrow is gone from the ledger', async () => {
      xrplVerificationService.escrowExistsOnLedger.mockResolvedValue(false);

      const result = await p2pMatchingService.classifyExpiredEscrow(expiredOrder(), mockClient);

      expect(result).toBe('cancelled');
      expect(xrplVerificationService.escrowExistsOnLedger).toHaveBeenCalledWith(mockClient, {
        owner: 'rSeller1234567890123456789012345678901234',
        transactionHash: 'd'.repeat(64)
      });
    });

    it('should classify as cancel_pending when the escrow still exists on-chain', async () => {
      xrplVerificationService.escrowExistsOnLedger.mockResolvedValue(true);

      const result = await p2pMatchingService.classifyExpiredEscrow(expiredOrder(), mockClient);

      expect(result).toBe('cancel_pending');
    });

    it('should skip when the ledger state is unknown', async () => {
      xrplVerificationService.escrowExistsOnLedger.mockResolvedValue(null);

      const result = await p2pMatchingService.classifyExpiredEscrow(expiredOrder(), mockClient);

      expect(result).toBe('skip');
    });

    it('should skip when no escrow owner is recorded', async () => {
      const order = expiredOrder();
      delete order.escrow_owner;

      const result = await p2pMatchingService.classifyExpiredEscrow(order, mockClient);

      expect(result).toBe('skip');
      expect(xrplVerificationService.escrowExistsOnLedger).not.toHaveBeenCalled();
    });
  });

  describe('dispute after rejected confirm-xrp', () => {
    const mockClient = { request: jest.fn() };
    it('should allow raising a dispute when confirm-xrp verification fails', async () => {
      xrplVerificationService.verifyPayment.mockResolvedValue({
        verified: false,
        reason: 'Transaction failed with result: tecPATH_DRY'
      });

      const order = {
        status: 'payment_confirmed',
        type: 'buy',
        id: 'test_order_123',
        xrplAddress: 'rBuyer1234567890123456789012345678901234',
        xrpAmount: 10
      };

      // Confirm-XRP fails verification
      await expect(
        p2pMatchingService.confirmXrpTransfer(order, 'a'.repeat(64), mockClient)
      ).rejects.toThrow('XRP transfer verification failed');

      // Order status must NOT have changed
      expect(order.status).toBe('payment_confirmed');

      // Dispute must still be possible
      const disputed = p2pMatchingService.raiseDispute(order, 'Seller never sent XRP', { screenshot: 'url' });
      expect(disputed.status).toBe('disputed');
      expect(disputed.disputeReason).toBe('Seller never sent XRP');
    });
  });

  describe('cancelOrder', () => {
    it('should cancel open order', () => {
      const order = {
        status: 'open',
        id: 'test_order_123'
      };

      const result = p2pMatchingService.cancelOrder(order, 'User cancelled');

      expect(result.status).toBe('cancelled');
      expect(result.cancelledAt).toBeDefined();
      expect(result.cancelReason).toBe('User cancelled');
    });

    it('should throw error for non-open order', () => {
      const order = {
        status: 'matched',
        id: 'test_order_123'
      };

      expect(() => {
        p2pMatchingService.cancelOrder(order, 'User cancelled');
      }).toThrow('Cannot cancel order in status: matched');
    });
  });

  describe('raiseDispute', () => {
    it('should raise dispute for matched order', () => {
      const order = {
        status: 'matched',
        id: 'test_order_123'
      };

      const result = p2pMatchingService.raiseDispute(order, 'Payment not received', 'evidence123');

      expect(result.status).toBe('disputed');
      expect(result.disputeReason).toBe('Payment not received');
      expect(result.disputeEvidence).toBe('evidence123');
      expect(result.disputeRaisedAt).toBeDefined();
    });

    it('should raise dispute for payment confirmed order', () => {
      const order = {
        status: 'payment_confirmed',
        id: 'test_order_123'
      };

      const result = p2pMatchingService.raiseDispute(order, 'XRP not sent', 'evidence123');

      expect(result.status).toBe('disputed');
    });

    it('should throw error for invalid order status', () => {
      const order = {
        status: 'open',
        id: 'test_order_123'
      };

      expect(() => {
        p2pMatchingService.raiseDispute(order, 'Test dispute', 'evidence123');
      }).toThrow('Cannot raise dispute for order in status: open');
    });

    it('should never allow disputes after completed or cancelled (PRD 3.2.2)', () => {
      expect(() => p2pMatchingService.raiseDispute({ status: 'completed' }, 'r', 'e'))
        .toThrow('Cannot raise dispute for order in status: completed');
      expect(() => p2pMatchingService.raiseDispute({ status: 'cancelled' }, 'r', 'e'))
        .toThrow('Cannot raise dispute for order in status: cancelled');
    });
  });

  describe('isExpired', () => {
    it('should return true for expired order', () => {
      const order = {
        status: 'open',
        expiresAt: new Date(Date.now() - 60000).toISOString()
      };

      expect(p2pMatchingService.isExpired(order)).toBe(true);
    });

    it('should return false for non-expired order', () => {
      const order = {
        status: 'open',
        expiresAt: new Date(Date.now() + 60000).toISOString()
      };

      expect(p2pMatchingService.isExpired(order)).toBe(false);
    });

    it('should return false for completed orders', () => {
      const order = {
        status: 'completed',
        expiresAt: new Date(Date.now() - 60000).toISOString()
      };

      expect(p2pMatchingService.isExpired(order)).toBe(false);
    });
  });

  describe('markExpiredOrders', () => {
    it('should mark expired open orders', () => {
      const orders = [
        {
          status: 'open',
          expiresAt: new Date(Date.now() - 60000).toISOString()
        },
        {
          status: 'open',
          expiresAt: new Date(Date.now() + 60000).toISOString()
        },
        {
          status: 'completed',
          expiresAt: new Date(Date.now() - 60000).toISOString()
        }
      ];

      const expiredCount = p2pMatchingService.markExpiredOrders(orders);

      expect(expiredCount).toBe(1);
      expect(orders[0].status).toBe('expired');
      expect(orders[0].expiredAt).toBeDefined();
      expect(orders[1].status).toBe('open');
      expect(orders[2].status).toBe('completed');
    });
  });

  describe('calculateOrderStats', () => {
    it('should calculate order statistics correctly', () => {
      const orders = [
        { status: 'open', type: 'buy', tryAmount: 100, xrpAmount: 10, rate: 10 },
        { status: 'matched', type: 'sell', tryAmount: 200, xrpAmount: 20, rate: 10 },
        { 
          status: 'completed', 
          type: 'buy', 
          tryAmount: 100, 
          xrpAmount: 10, 
          rate: 10,
          finalTryAmount: 100,
          finalXrpAmount: 10,
          finalRate: 10,
          createdAt: new Date(Date.now() - 300000).toISOString(),
          completedAt: new Date().toISOString()
        },
        { status: 'cancelled', type: 'sell', tryAmount: 150, xrpAmount: 15, rate: 10 },
        { status: 'disputed', type: 'buy', tryAmount: 50, xrpAmount: 5, rate: 10 }
      ];

      const stats = p2pMatchingService.calculateOrderStats(orders);

      expect(stats).toEqual({
        total: 5,
        open: 1,
        matched: 1,
        completed: 1,
        cancelled: 1,
        disputed: 1,
        avgCompletionTime: 5, // 5 minutes
        totalVolumeTRY: 100,
        totalVolumeXRP: 10,
        avgRate: 10,
        buyOrders: 3,
        sellOrders: 2
      });
    });
  });

  describe('getOrderSummary', () => {
    it('should return order summary', () => {
      const created = new Date().toISOString();
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const order = {
        id: 'test_order_123',
        type: 'buy',
        status: 'open',
        tryAmount: 100,
        xrpAmount: 10,
        rate: 10,
        paymentMethods: ['bank_transfer'],
        createdAt: created,
        expiresAt: expires,
        rating: 5,
        completedTrades: 10,
        matchedOrderId: null,
        counterpartyAddress: null
      };

      const summary = p2pMatchingService.getOrderSummary(order);

      expect(summary).toEqual({
        id: 'test_order_123',
        type: 'buy',
        status: 'open',
        tryAmount: 100,
        xrpAmount: 10,
        rate: 10,
        paymentMethods: ['bank_transfer'],
        createdAt: created,
        expiresAt: expires,
        isExpired: false,
        rating: 5,
        completedTrades: 10,
        matchedOrderId: null,
        counterpartyAddress: null,
        escrowStatus: 'none'
      });
    });
  });
});

describe('Trade state machine (PRD 3.1.3)', () => {
  const { ORDER_STATUS, ORDER_TRANSITIONS, canTransition, transitionOrder } = p2pMatchingService;

  test('transitionOrder allows the reference happy path', () => {
    const order = { status: ORDER_STATUS.OPEN };
    transitionOrder(order, ORDER_STATUS.MATCHED);
    transitionOrder(order, ORDER_STATUS.PAYMENT_CONFIRMED);
    transitionOrder(order, ORDER_STATUS.COMPLETED);
    expect(order.status).toBe(ORDER_STATUS.COMPLETED);
  });

  test('illegal transitions throw descriptive errors', () => {
    expect(() => transitionOrder({ status: 'open' }, 'completed')).toThrow(/Illegal order status transition: open → completed/);
    expect(() => transitionOrder({ status: 'open' }, 'payment_confirmed')).toThrow(/Illegal/);
    expect(() => transitionOrder({ status: 'completed' }, 'disputed')).toThrow(/Illegal/);
    expect(() => transitionOrder({ status: 'cancelled' }, 'open')).toThrow(/Illegal/);
    expect(() => transitionOrder({ status: 'expired' }, 'open')).toThrow(/Illegal/);
    expect(() => transitionOrder({ status: 'matched' }, 'completed')).toThrow(/Illegal/);
  });

  test('cancel is allowed from open and matched, never from payment_confirmed or later', () => {
    expect(canTransition('open', 'cancelled')).toBe(true);
    expect(canTransition('matched', 'cancelled')).toBe(true);
    expect(canTransition('payment_confirmed', 'cancelled')).toBe(false);
    expect(canTransition('completed', 'cancelled')).toBe(false);
  });

  test('dispute is allowed from matched and payment_confirmed, never after terminal states', () => {
    expect(canTransition('matched', 'disputed')).toBe(true);
    expect(canTransition('payment_confirmed', 'disputed')).toBe(true);
    expect(canTransition('completed', 'disputed')).toBe(false);
    expect(canTransition('cancelled', 'disputed')).toBe(false);
  });

  test('moderator resolution paths from disputed', () => {
    expect(canTransition('disputed', 'completed')).toBe(true);
    expect(canTransition('disputed', 'cancelled')).toBe(true);
    expect(canTransition('disputed', 'open')).toBe(false);
  });

  test('counterparty reopen matched → open is allowed, payment_confirmed → open is not', () => {
    expect(canTransition('matched', 'open')).toBe(true);
    expect(canTransition('payment_confirmed', 'open')).toBe(false);
  });

  test('every status key has a transitions entry', () => {
    Object.values(ORDER_STATUS).forEach(s => {
      expect(Array.isArray(ORDER_TRANSITIONS[s])).toBe(true);
    });
  });
});
