/**
 * Unit tests for the XRPL Escrow Service
 */

const xrplEscrowService = require('../xrplEscrowService');

// Fixed valid classic addresses (xrpl.Wallet.generate requires crypto
// entropy that is unavailable in the jest environment)
const ADDRESS_A = 'rDX3rup2q1xRFSypsPsrufMdXrG6rJxT6o';
const ADDRESS_B = 'rhngfvipRe7wzdUVoCJhQ5aUk9hFKrSgZT';
const walletA = { address: ADDRESS_A };
const walletB = { address: ADDRESS_B };

describe('xrplEscrowService', () => {
  describe('generatePreimage / conditionFromPreimage', () => {
    it('generates random 64-char hex preimages', () => {
      const preimage = xrplEscrowService.generatePreimage();
      expect(preimage).toMatch(/^[A-F0-9]{64}$/);
    });

    it('generates a different preimage per call (no deterministic derivation)', () => {
      const p1 = xrplEscrowService.generatePreimage();
      const p2 = xrplEscrowService.generatePreimage();
      expect(p1).not.toBe(p2);
    });

    it('condition is the PREIMAGE-SHA-256 crypto-condition of the preimage', () => {
      const crypto = require('node:crypto');
      const preimage = xrplEscrowService.generatePreimage();
      const digest = crypto.createHash('sha256')
        .update(Buffer.from(preimage, 'hex'))
        .digest('hex');
      // On-chain format: A0258020 <sha256(preimage)> 8101 <cost=32=0x20>
      const expected = ('A0258020' + digest + '810120').toUpperCase();
      expect(xrplEscrowService.conditionFromPreimage(preimage)).toBe(expected);
    });

    it('throws for an invalid preimage', () => {
      expect(() => xrplEscrowService.conditionFromPreimage('bad')).toThrow('Invalid escrow preimage');
    });
  });

  describe('prepareEscrowCreate', () => {
    it('builds a valid EscrowCreate transaction', () => {
      const { transaction, condition, finishAfter, cancelAfter } = xrplEscrowService.prepareEscrowCreate({
        sourceAddress: walletA.address,
        destinationAddress: walletB.address,
        xrpAmount: 10,
        orderId: 'buy_order_123'
      });

      expect(transaction.TransactionType).toBe('EscrowCreate');
      expect(transaction.Account).toBe(walletA.address);
      expect(transaction.Destination).toBe(walletB.address);
      expect(transaction.Amount).toBe('10000000');
      expect(transaction.Condition).toBe(condition);
      expect(typeof transaction.FinishAfter).toBe('number');
      expect(typeof transaction.CancelAfter).toBe('number');
      expect(cancelAfter).toBeGreaterThan(finishAfter);
      expect(transaction.Memos).toHaveLength(1);
    });

    it('returns the encoded fulfillment and a condition that validates against it', () => {
      const crypto = require('node:crypto');
      const { condition, fulfillment } = xrplEscrowService.prepareEscrowCreate({
        sourceAddress: walletA.address,
        destinationAddress: walletB.address,
        xrpAmount: 10,
        orderId: 'buy_order_123'
      });

      // Fulfillment blob: A0228020 <32-byte preimage>
      expect(fulfillment).toMatch(/^A0228020[A-F0-9]{64}$/);
      const preimage = fulfillment.slice(8);
      const digest = crypto.createHash('sha256')
        .update(Buffer.from(preimage, 'hex'))
        .digest('hex');
      // Condition: A0258020 <sha256(preimage)> 8101 <cost=32=0x20>
      const expected = ('A0258020' + digest + '810120').toUpperCase();
      expect(condition).toBe(expected);
    });

    it('gives two escrows for the same order/destination different conditions', () => {
      const first = xrplEscrowService.prepareEscrowCreate({
        sourceAddress: walletA.address,
        destinationAddress: walletB.address,
        xrpAmount: 10,
        orderId: 'buy_order_123'
      });
      const second = xrplEscrowService.prepareEscrowCreate({
        sourceAddress: walletA.address,
        destinationAddress: walletB.address,
        xrpAmount: 10,
        orderId: 'buy_order_123'
      });

      expect(first.condition).not.toBe(second.condition);
      expect(first.fulfillment).not.toBe(second.fulfillment);
    });

    it('throws 400 for a negative amount', () => {
      expect(() => xrplEscrowService.prepareEscrowCreate({
        sourceAddress: walletA.address,
        destinationAddress: walletB.address,
        xrpAmount: -10,
        orderId: 'buy_order_123'
      })).toThrow('xrpAmount must be a positive number');
    });

    it('throws 400 for an invalid destination address', () => {
      expect(() => xrplEscrowService.prepareEscrowCreate({
        sourceAddress: walletA.address,
        destinationAddress: 'invalid_address',
        xrpAmount: 10,
        orderId: 'buy_order_123'
      })).toThrow('Invalid XRPL address');
    });

    it('throws 400 when orderId is missing', () => {
      expect(() => xrplEscrowService.prepareEscrowCreate({
        sourceAddress: walletA.address,
        destinationAddress: walletB.address,
        xrpAmount: 10
      })).toThrow('orderId is required');
    });
  });

  describe('prepareEscrowFinish', () => {
    it('builds a valid EscrowFinish transaction', () => {
      const fulfillment = xrplEscrowService.generatePreimage();
      const condition = xrplEscrowService.conditionFromPreimage(fulfillment);

      const tx = xrplEscrowService.prepareEscrowFinish({
        account: walletA.address,
        owner: walletA.address,
        offerSequence: 42,
        condition,
        fulfillment
      });

      expect(tx.TransactionType).toBe('EscrowFinish');
      expect(tx.Owner).toBe(walletA.address);
      expect(tx.OfferSequence).toBe(42);
      expect(tx.Condition).toBe(condition);
      expect(tx.Fulfillment).toBe(fulfillment);
    });

    it('omits OfferSequence when not provided', () => {
      const fulfillment = xrplEscrowService.generatePreimage();
      const condition = xrplEscrowService.conditionFromPreimage(fulfillment);

      const tx = xrplEscrowService.prepareEscrowFinish({
        account: walletA.address,
        owner: walletA.address,
        condition,
        fulfillment
      });

      expect(tx.OfferSequence).toBeUndefined();
    });

    it('throws for an invalid condition', () => {
      expect(() => xrplEscrowService.prepareEscrowFinish({
        account: walletA.address,
        owner: walletA.address,
        condition: 'bad',
        fulfillment: 'AB12'
      })).toThrow('Invalid escrow condition');
    });
  });

  describe('prepareEscrowCancel', () => {
    it('builds a valid EscrowCancel transaction', () => {
      const tx = xrplEscrowService.prepareEscrowCancel({
        account: walletA.address,
        owner: walletA.address,
        offerSequence: 7
      });

      expect(tx.TransactionType).toBe('EscrowCancel');
      expect(tx.Account).toBe(walletA.address);
      expect(tx.Owner).toBe(walletA.address);
      expect(tx.OfferSequence).toBe(7);
    });

    it('throws for an invalid owner address', () => {
      expect(() => xrplEscrowService.prepareEscrowCancel({
        account: walletA.address,
        owner: 'nope'
      })).toThrow('Invalid XRPL address');
    });
  });

  describe('assertValidHash', () => {
    it('accepts a 64-char hex hash', () => {
      expect(() => xrplEscrowService.assertValidHash('a'.repeat(64))).not.toThrow();
    });

    it('rejects a short hash', () => {
      expect(() => xrplEscrowService.assertValidHash('shortHash')).toThrow('Invalid transaction hash');
    });
  });

  describe('toRippleTime', () => {
    it('converts Unix time to Ripple epoch time', () => {
      const date = new Date('2000-01-01T00:00:00Z');
      expect(xrplEscrowService.toRippleTime(date)).toBe(0);
    });
  });
});
