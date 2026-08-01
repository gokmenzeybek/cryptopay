/**
 * Unit tests for the XRPL Verification Service
 */

const xrplVerificationService = require('../xrplVerificationService');

// Fixed valid classic addresses (matching pattern used in xrplEscrowService.test.js)
const ADDRESS_A = 'rDX3rup2q1xRFSypsPsrufMdXrG6rJxT6o';
const ADDRESS_B = 'rhngfvipRe7wzdUVoCJhQ5aUk9hFKrSgZT';

function makeMockClient(result) {
  return {
    request: jest.fn().mockResolvedValue({ result })
  };
}

function makeMockClientRejection(error) {
  return {
    request: jest.fn().mockRejectedValue(error)
  };
}

function makeValidPaymentResult(overrides = {}) {
  return {
    validated: true,
    TransactionType: 'Payment',
    Account: ADDRESS_A,
    Destination: ADDRESS_B,
    Amount: '10000000', // 10 XRP in drops
    meta: {
      TransactionResult: 'tesSUCCESS',
      delivered_amount: '10000000'
    },
    ...overrides
  };
}

function makeValidEscrowCreateResult(overrides = {}) {
  return {
    validated: true,
    TransactionType: 'EscrowCreate',
    Account: ADDRESS_A,
    Destination: ADDRESS_B,
    Amount: '5000000', // 5 XRP in drops
    Condition: 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899',
    meta: {
      TransactionResult: 'tesSUCCESS'
    },
    ...overrides
  };
}

describe('xrplVerificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyPayment', () => {
    it('returns verified:true for a valid payment', async () => {
      const client = makeMockClient(makeValidPaymentResult());
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: 'a'.repeat(64),
        expectedDestination: ADDRESS_B,
        minAmountXrp: 10
      });
      expect(result.verified).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('rejects an unvalidated transaction', async () => {
      const client = makeMockClient(makeValidPaymentResult({ validated: false }));
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: 'a'.repeat(64),
        expectedDestination: ADDRESS_B,
        minAmountXrp: 10
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Transaction is not yet validated');
    });

    it('rejects a tec-failed transaction', async () => {
      const client = makeMockClient(makeValidPaymentResult({
        meta: { TransactionResult: 'tecPATH_DRY', delivered_amount: '0' }
      }));
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: 'a'.repeat(64),
        expectedDestination: ADDRESS_B,
        minAmountXrp: 10
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Transaction failed with result: tecPATH_DRY');
    });

    it('rejects a payment with wrong destination', async () => {
      const client = makeMockClient(makeValidPaymentResult({
        Destination: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfHgFj'
      }));
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: 'a'.repeat(64),
        expectedDestination: ADDRESS_B,
        minAmountXrp: 10
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Destination mismatch');
    });

    it('rejects a payment with insufficient amount', async () => {
      const client = makeMockClient(makeValidPaymentResult({
        Amount: '5000000', // 5 XRP
        meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '5000000' }
      }));
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: 'a'.repeat(64),
        expectedDestination: ADDRESS_B,
        minAmountXrp: 10
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Amount insufficient');
    });

    it('rejects when transaction is not found (txnNotFound error)', async () => {
      const client = makeMockClientRejection({
        data: { error: 'txnNotFound', error_message: 'Transaction not found.' }
      });
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: 'a'.repeat(64),
        expectedDestination: ADDRESS_B,
        minAmountXrp: 10
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Transaction not found on ledger');
    });

    it('rejects when client.request throws an unexpected error', async () => {
      const client = makeMockClientRejection(new Error('Network timeout'));
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: 'a'.repeat(64),
        expectedDestination: ADDRESS_B,
        minAmountXrp: 10
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Network timeout');
    });

    it('rejects when transaction type is not Payment', async () => {
      const client = makeMockClient(makeValidPaymentResult({ TransactionType: 'OfferCreate' }));
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: 'a'.repeat(64),
        expectedDestination: ADDRESS_B,
        minAmountXrp: 10
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Expected Payment, got OfferCreate');
    });

    it('returns false when hash is missing', async () => {
      const client = makeMockClient({});
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: '',
        expectedDestination: ADDRESS_B,
        minAmountXrp: 10
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Transaction hash is required');
      expect(client.request).not.toHaveBeenCalled();
    });

    it('returns false when minAmountXrp is not positive', async () => {
      const client = makeMockClient({});
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: 'a'.repeat(64),
        expectedDestination: ADDRESS_B,
        minAmountXrp: -5
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('minAmountXrp must be a positive number');
      expect(client.request).not.toHaveBeenCalled();
    });

    it('accepts amount from delivered_amount when available', async () => {
      const client = makeMockClient(makeValidPaymentResult({
        Amount: '12000000',
        meta: { TransactionResult: 'tesSUCCESS', delivered_amount: '10000000' }
      }));
      const result = await xrplVerificationService.verifyPayment(client, {
        hash: 'a'.repeat(64),
        expectedDestination: ADDRESS_B,
        minAmountXrp: 10
      });
      expect(result.verified).toBe(true);
    });
  });

  describe('verifyEscrowCreate', () => {
    it('returns verified:true for a valid EscrowCreate', async () => {
      const client = makeMockClient(makeValidEscrowCreateResult());
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: 'b'.repeat(64),
        expectedOwner: ADDRESS_A,
        expectedDestination: ADDRESS_B,
        expectedAmountXrp: 5,
        expectedCondition: 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899'
      });
      expect(result.verified).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('rejects an unvalidated EscrowCreate', async () => {
      const client = makeMockClient(makeValidEscrowCreateResult({ validated: false }));
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: 'b'.repeat(64),
        expectedOwner: ADDRESS_A,
        expectedDestination: ADDRESS_B,
        expectedAmountXrp: 5,
        expectedCondition: 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899'
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Transaction is not yet validated');
    });

    it('rejects when owner does not match', async () => {
      const client = makeMockClient(makeValidEscrowCreateResult());
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: 'b'.repeat(64),
        expectedOwner: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfHgFj',
        expectedDestination: ADDRESS_B,
        expectedAmountXrp: 5,
        expectedCondition: 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899'
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Owner mismatch');
    });

    it('accepts a matching expectedSequence', async () => {
      const client = makeMockClient(makeValidEscrowCreateResult({ Sequence: 42 }));
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: 'b'.repeat(64),
        expectedOwner: ADDRESS_A,
        expectedDestination: ADDRESS_B,
        expectedAmountXrp: 5,
        expectedCondition: 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899',
        expectedSequence: 42
      });
      expect(result.verified).toBe(true);
    });

    it('rejects when sequence does not match', async () => {
      const client = makeMockClient(makeValidEscrowCreateResult({ Sequence: 42 }));
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: 'b'.repeat(64),
        expectedOwner: ADDRESS_A,
        expectedDestination: ADDRESS_B,
        expectedAmountXrp: 5,
        expectedCondition: 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899',
        expectedSequence: 43
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Sequence mismatch');
    });

    it('rejects when destination does not match', async () => {
      const client = makeMockClient(makeValidEscrowCreateResult());
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: 'b'.repeat(64),
        expectedOwner: ADDRESS_A,
        expectedDestination: 'rN7n7otQDd6FczFgLdlqtyMVrn3HMfHgFj',
        expectedAmountXrp: 5,
        expectedCondition: 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899'
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Destination mismatch');
    });

    it('rejects when amount does not match', async () => {
      const client = makeMockClient(makeValidEscrowCreateResult());
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: 'b'.repeat(64),
        expectedOwner: ADDRESS_A,
        expectedDestination: ADDRESS_B,
        expectedAmountXrp: 7,
        expectedCondition: 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899'
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Amount mismatch');
    });

    it('rejects when condition does not match', async () => {
      const client = makeMockClient(makeValidEscrowCreateResult());
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: 'b'.repeat(64),
        expectedOwner: ADDRESS_A,
        expectedDestination: ADDRESS_B,
        expectedAmountXrp: 5,
        expectedCondition: 'CCDDEEFFAABB00112233445566778899AABBCCDDEEFF00112233445566778899'
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Condition mismatch');
    });

    it('rejects when transaction type is not EscrowCreate', async () => {
      const client = makeMockClient(makeValidEscrowCreateResult({ TransactionType: 'Payment' }));
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: 'b'.repeat(64),
        expectedOwner: ADDRESS_A,
        expectedDestination: ADDRESS_B,
        expectedAmountXrp: 5,
        expectedCondition: 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899'
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Expected EscrowCreate, got Payment');
    });

    it('rejects when transaction is not found (txnNotFound)', async () => {
      const client = makeMockClientRejection({
        data: { error: 'txnNotFound', error_message: 'Transaction not found.' }
      });
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: 'b'.repeat(64),
        expectedOwner: ADDRESS_A,
        expectedDestination: ADDRESS_B,
        expectedAmountXrp: 5,
        expectedCondition: 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899'
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Transaction not found on ledger');
    });

    it('returns false when required params are missing', async () => {
      const client = makeMockClient({});
      const result = await xrplVerificationService.verifyEscrowCreate(client, {
        hash: '',
        expectedOwner: ADDRESS_A,
        expectedDestination: ADDRESS_B,
        expectedAmountXrp: 5,
        expectedCondition: 'COND'
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Transaction hash is required');
      expect(client.request).not.toHaveBeenCalled();
    });
  });

  describe('verifyEscrowCompletion', () => {
    function makeValidEscrowFinishResult(overrides = {}) {
      return {
        validated: true,
        TransactionType: 'EscrowFinish',
        Account: ADDRESS_B,
        Owner: ADDRESS_A,
        OfferSequence: 42,
        meta: {
          TransactionResult: 'tesSUCCESS'
        },
        ...overrides
      };
    }

    it('returns verified:true for a valid EscrowFinish', async () => {
      const client = makeMockClient(makeValidEscrowFinishResult());
      const result = await xrplVerificationService.verifyEscrowCompletion(client, {
        hash: 'c'.repeat(64),
        expectedType: 'EscrowFinish',
        expectedOwner: ADDRESS_A,
        expectedOfferSequence: 42
      });
      expect(result.verified).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns verified:true for a valid EscrowCancel', async () => {
      const client = makeMockClient(makeValidEscrowFinishResult({ TransactionType: 'EscrowCancel' }));
      const result = await xrplVerificationService.verifyEscrowCompletion(client, {
        hash: 'c'.repeat(64),
        expectedType: 'EscrowCancel',
        expectedOwner: ADDRESS_A,
        expectedOfferSequence: 42
      });
      expect(result.verified).toBe(true);
    });

    it('rejects when the transaction type does not match the expected type', async () => {
      const client = makeMockClient(makeValidEscrowFinishResult({ TransactionType: 'EscrowCancel' }));
      const result = await xrplVerificationService.verifyEscrowCompletion(client, {
        hash: 'c'.repeat(64),
        expectedType: 'EscrowFinish',
        expectedOwner: ADDRESS_A,
        expectedOfferSequence: 42
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Expected EscrowFinish, got EscrowCancel');
    });

    it('rejects an unsupported expectedType without calling the ledger', async () => {
      const client = makeMockClient({});
      const result = await xrplVerificationService.verifyEscrowCompletion(client, {
        hash: 'c'.repeat(64),
        expectedType: 'Payment',
        expectedOwner: ADDRESS_A,
        expectedOfferSequence: 42
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Unsupported escrow completion type');
      expect(client.request).not.toHaveBeenCalled();
    });

    it('rejects when owner does not match', async () => {
      const client = makeMockClient(makeValidEscrowFinishResult());
      const result = await xrplVerificationService.verifyEscrowCompletion(client, {
        hash: 'c'.repeat(64),
        expectedType: 'EscrowFinish',
        expectedOwner: ADDRESS_B,
        expectedOfferSequence: 42
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Owner mismatch');
    });

    it('rejects when offer sequence does not match', async () => {
      const client = makeMockClient(makeValidEscrowFinishResult());
      const result = await xrplVerificationService.verifyEscrowCompletion(client, {
        hash: 'c'.repeat(64),
        expectedType: 'EscrowFinish',
        expectedOwner: ADDRESS_A,
        expectedOfferSequence: 43
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('OfferSequence mismatch');
    });

    it('rejects an unvalidated transaction', async () => {
      const client = makeMockClient(makeValidEscrowFinishResult({ validated: false }));
      const result = await xrplVerificationService.verifyEscrowCompletion(client, {
        hash: 'c'.repeat(64),
        expectedType: 'EscrowFinish',
        expectedOwner: ADDRESS_A,
        expectedOfferSequence: 42
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Transaction is not yet validated');
    });

    it('rejects a tec-failed transaction', async () => {
      const client = makeMockClient(makeValidEscrowFinishResult({
        meta: { TransactionResult: 'tecCRYPTOCONDITION_ERROR' }
      }));
      const result = await xrplVerificationService.verifyEscrowCompletion(client, {
        hash: 'c'.repeat(64),
        expectedType: 'EscrowFinish',
        expectedOwner: ADDRESS_A,
        expectedOfferSequence: 42
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('tecCRYPTOCONDITION_ERROR');
    });

    it('returns false when the transaction is not found', async () => {
      const client = makeMockClientRejection({ data: { error: 'txnNotFound' } });
      const result = await xrplVerificationService.verifyEscrowCompletion(client, {
        hash: 'c'.repeat(64),
        expectedType: 'EscrowFinish',
        expectedOwner: ADDRESS_A,
        expectedOfferSequence: 42
      });
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('Transaction not found on ledger');
    });
  });

  describe('escrowExistsOnLedger', () => {
    it('returns true when an escrow with a matching PreviousTxnID exists', async () => {
      const client = {
        request: jest.fn().mockResolvedValue({
          result: {
            account_objects: [
              { LedgerEntryType: 'Escrow', PreviousTxnID: 'd'.repeat(64) }
            ]
          }
        })
      };
      const exists = await xrplVerificationService.escrowExistsOnLedger(client, {
        owner: ADDRESS_A,
        transactionHash: 'd'.repeat(64)
      });
      expect(exists).toBe(true);
      expect(client.request).toHaveBeenCalledWith({
        command: 'account_objects',
        account: ADDRESS_A,
        type: 'escrow',
        ledger_index: 'validated'
      });
    });

    it('returns false when no escrow objects remain', async () => {
      const client = {
        request: jest.fn().mockResolvedValue({ result: { account_objects: [] } })
      };
      const exists = await xrplVerificationService.escrowExistsOnLedger(client, {
        owner: ADDRESS_A,
        transactionHash: 'd'.repeat(64)
      });
      expect(exists).toBe(false);
    });

    it('returns false when escrows exist but none match the hash', async () => {
      const client = {
        request: jest.fn().mockResolvedValue({
          result: {
            account_objects: [
              { LedgerEntryType: 'Escrow', PreviousTxnID: 'e'.repeat(64) }
            ]
          }
        })
      };
      const exists = await xrplVerificationService.escrowExistsOnLedger(client, {
        owner: ADDRESS_A,
        transactionHash: 'd'.repeat(64)
      });
      expect(exists).toBe(false);
    });

    it('returns null when the ledger query fails', async () => {
      const client = {
        request: jest.fn().mockRejectedValue(new Error('connection lost'))
      };
      const exists = await xrplVerificationService.escrowExistsOnLedger(client, {
        owner: ADDRESS_A,
        transactionHash: 'd'.repeat(64)
      });
      expect(exists).toBeNull();
    });

    it('returns null when owner is missing', async () => {
      const client = { request: jest.fn() };
      const exists = await xrplVerificationService.escrowExistsOnLedger(client, {});
      expect(exists).toBeNull();
      expect(client.request).not.toHaveBeenCalled();
    });
  });

  describe('_dropsToXrp', () => {
    it('converts drops to XRP correctly', () => {
      expect(xrplVerificationService._dropsToXrp('1000000')).toBe(1);
      expect(xrplVerificationService._dropsToXrp('5000000')).toBe(5);
      expect(xrplVerificationService._dropsToXrp('1234567')).toBe(1.234567);
    });
  });

  describe('_extractDeliveredXrp', () => {
    it('prefers meta.delivered_amount when available', () => {
      const result = {
        Amount: '10000000',
        meta: { delivered_amount: '8000000', TransactionResult: 'tesSUCCESS' }
      };
      const extracted = xrplVerificationService._extractDeliveredXrp(result);
      expect(extracted.amountXrp).toBe(8);
      expect(extracted.source).toBe('delivered_amount');
    });

    it('falls back to Amount when delivered_amount is unavailable', () => {
      const result = {
        Amount: '10000000',
        meta: { TransactionResult: 'tesSUCCESS' }
      };
      const extracted = xrplVerificationService._extractDeliveredXrp(result);
      expect(extracted.amountXrp).toBe(10);
      expect(extracted.source).toBe('Amount');
    });

    it('returns null for non-numeric delivered_amount', () => {
      const result = {
        Amount: '10000000',
        meta: { delivered_amount: 'unavailable', TransactionResult: 'tesSUCCESS' }
      };
      const extracted = xrplVerificationService._extractDeliveredXrp(result);
      expect(extracted.amountXrp).toBe(10);
      expect(extracted.source).toBe('Amount');
    });

    it('returns null when neither amount is numeric', () => {
      const result = {
        Amount: { currency: 'USD', issuer: 'r...', value: '100' },
        meta: { TransactionResult: 'tesSUCCESS' }
      };
      const extracted = xrplVerificationService._extractDeliveredXrp(result);
      expect(extracted).toBeNull();
    });
  });
});
