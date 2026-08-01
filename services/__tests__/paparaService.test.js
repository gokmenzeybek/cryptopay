/**
 * Unit Tests for Papara Service
 *
 * The service never fabricates data: all Papara API behavior is exercised
 * through explicit test doubles of the Papara SDK (jest.mock below).
 * Without a configured API key the service must throw configuration errors.
 */

const { PaparaService, PaparaAPIError, PaparaValidationError, PaparaInsufficientFundsError } = require('../paparaService');

// Mock the Papara SDK (explicit test double)
jest.mock('@papara/papara', () => ({
  PaparaClient: jest.fn().mockImplementation(() => ({
    validationService: {
      validateByAccountNumber: jest.fn()
    },
    paymentService: {
      createPayment: jest.fn(),
      getPayment: jest.fn()
    },
    accountService: {
      getAccount: jest.fn()
    }
  }))
}));

describe('Papara Service', () => {
  let paparaService;
  let mockClient;

  beforeEach(() => {
    // Reset environment variables
    process.env.PAPARA_API_KEY = 'test_api_key';
    process.env.PAPARA_ENVIRONMENT = 'sandbox';
    process.env.PAPARA_MERCHANT_ID = 'test_merchant';

    paparaService = new PaparaService();
    mockClient = paparaService.client;

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with API key when provided', () => {
      process.env.PAPARA_API_KEY = 'valid_api_key';
      process.env.PAPARA_ENVIRONMENT = 'production';
      const service = new PaparaService();
      expect(service.client).toBeDefined();
      expect(service.isSandboxMode()).toBe(false);
    });

    it('should have a null client when the API key is a placeholder', () => {
      process.env.PAPARA_API_KEY = 'your_papara_api_key_here';
      const service = new PaparaService();
      expect(service.client).toBeNull();
    });

    it('should throw a configuration error in production without an API key', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      delete process.env.PAPARA_API_KEY;
      try {
        expect(() => new PaparaService()).toThrow(PaparaAPIError);
        expect(() => new PaparaService()).toThrow('PAPARA_API_KEY is not configured');
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('should set environment correctly', () => {
      process.env.PAPARA_ENVIRONMENT = 'production';
      process.env.PAPARA_API_KEY = 'valid_api_key';
      const service = new PaparaService();
      expect(service.environment).toBe('production');
    });
  });

  describe('isSandboxMode', () => {
    it('should return true when in sandbox environment', () => {
      process.env.PAPARA_ENVIRONMENT = 'sandbox';
      const service = new PaparaService();
      expect(service.isSandboxMode()).toBe(true);
    });

    it('should return false when in production environment with valid API key', () => {
      process.env.PAPARA_ENVIRONMENT = 'production';
      process.env.PAPARA_API_KEY = 'valid_api_key';
      const service = new PaparaService();
      expect(service.isSandboxMode()).toBe(false);
    });
  });

  describe('configuration errors (no API key)', () => {
    let unconfigured;
    beforeEach(() => {
      process.env.PAPARA_API_KEY = 'your_papara_api_key_here';
      unconfigured = new PaparaService();
    });

    it('validateAccount should throw a configuration error instead of fabricating data', async () => {
      await expect(unconfigured.validateAccount('1234567890'))
        .rejects.toThrow('Papara API key is not configured');
    });

    it('sendPayment should throw a configuration error instead of fabricating data', async () => {
      await expect(unconfigured.sendPayment(100, '1234567890', 'Test payment', {}))
        .rejects.toThrow('Papara API key is not configured');
    });

    it('getPaymentStatus should throw a configuration error instead of fabricating data', async () => {
      await expect(unconfigured.getPaymentStatus('tx123'))
        .rejects.toThrow('Papara API key is not configured');
    });

    it('getAccountBalance should throw a configuration error instead of fabricating data', async () => {
      await expect(unconfigured.getAccountBalance())
        .rejects.toThrow('Papara API key is not configured');
    });
  });

  describe('validateAccount', () => {
    it('should validate account successfully via the Papara API', async () => {
      const mockValidation = {
        succeeded: true,
        data: {
          userId: 'user123',
          firstName: 'John',
          lastName: 'Doe',
          accountNumber: 1234567890,
          email: 'john@example.com',
          phoneNumber: '+905551234567'
        }
      };

      mockClient.validationService.validateByAccountNumber.mockResolvedValue(mockValidation);

      const result = await paparaService.validateAccount('1234567890');

      expect(result.success).toBe(true);
      expect(result.accountExists).toBe(true);
      expect(result.accountHolder).toBe('John Doe');
      expect(result.accountNumber).toBe('1234567890');
      expect(result.email).toBe('john@example.com');
      expect(result.phoneNumber).toBe('+905551234567');
      expect(result.userId).toBe('user123');
      expect(mockClient.validationService.validateByAccountNumber).toHaveBeenCalledWith({
        accountNumber: 1234567890
      });
    });

    it('should throw validation error for invalid account number format', async () => {
      await expect(paparaService.validateAccount('123')).rejects.toThrow(PaparaValidationError);
      await expect(paparaService.validateAccount('abc1234567')).rejects.toThrow(PaparaValidationError);
      await expect(paparaService.validateAccount('')).rejects.toThrow(PaparaValidationError);
      expect(mockClient.validationService.validateByAccountNumber).not.toHaveBeenCalled();
    });

    it('should throw API error when validation fails', async () => {
      const mockError = {
        succeeded: false,
        error: {
          message: 'Account not found',
          code: 'ACCOUNT_NOT_FOUND'
        }
      };

      mockClient.validationService.validateByAccountNumber.mockResolvedValue(mockError);

      await expect(paparaService.validateAccount('1234567890')).rejects.toThrow(PaparaAPIError);
    });
  });

  describe('sendPayment', () => {
    it('should send payment successfully via the Papara API', async () => {
      const mockPayment = {
        succeeded: true,
        data: {
          id: 'payment123',
          referenceId: 'ref123',
          status: 0,
          amount: 100,
          fee: 1,
          paymentUrl: 'https://papara.com/pay/payment123',
          createdAt: new Date()
        }
      };

      mockClient.paymentService.createPayment.mockResolvedValue(mockPayment);

      const result = await paparaService.sendPayment(100, '1234567890', 'Test payment', {});

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('payment123');
      expect(result.referenceId).toBe('ref123');
      expect(result.status).toBe('pending');
      expect(result.amount).toBe(100);
      expect(result.fee).toBe(1);
      expect(result.paymentUrl).toBe('https://papara.com/pay/payment123');
      expect(result.message).toBe('Payment created successfully');
    });

    it('should embed the order ID in the referenceId when provided', async () => {
      const mockPayment = {
        succeeded: true,
        data: {
          id: 'payment123',
          referenceId: 'ref123',
          status: 0,
          amount: 100,
          fee: 1,
          paymentUrl: 'https://papara.com/pay/payment123',
          createdAt: new Date()
        }
      };

      mockClient.paymentService.createPayment.mockResolvedValue(mockPayment);

      await paparaService.sendPayment(100, '1234567890', 'Test payment', { orderId: 'order_abc' });

      const payload = mockClient.paymentService.createPayment.mock.calls[0][0];
      expect(payload.referenceId).toMatch(/^P2P_order_abc_\d+$/);
    });

    it('should throw validation error for invalid inputs', async () => {
      await expect(paparaService.sendPayment(0, '1234567890', 'Test', {})).rejects.toThrow(PaparaValidationError);
      await expect(paparaService.sendPayment(100, '', 'Test', {})).rejects.toThrow(PaparaValidationError);
      await expect(paparaService.sendPayment(100, '1234567890', '', {})).rejects.toThrow(PaparaValidationError);
      expect(mockClient.paymentService.createPayment).not.toHaveBeenCalled();
    });

    it('should throw API error when payment creation fails', async () => {
      const mockError = {
        succeeded: false,
        error: {
          message: 'Insufficient funds',
          code: 'INSUFFICIENT_FUNDS'
        }
      };

      mockClient.paymentService.createPayment.mockResolvedValue(mockError);

      await expect(paparaService.sendPayment(100, '1234567890', 'Test payment', {})).rejects.toThrow(PaparaAPIError);
    });
  });

  describe('getPaymentStatus', () => {
    it('should get payment status successfully via the Papara API', async () => {
      const mockStatus = {
        succeeded: true,
        data: {
          id: 'payment123',
          status: 1,
          statusDescription: 'Payment completed',
          amount: 100,
          fee: 1,
          createdAt: new Date(),
          paymentMethod: 0,
          paymentMethodDescription: 'Papara Balance'
        }
      };

      mockClient.paymentService.getPayment.mockResolvedValue(mockStatus);

      const result = await paparaService.getPaymentStatus('payment123');

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('payment123');
      expect(result.status).toBe('completed');
      expect(result.statusDescription).toBe('Payment completed');
      expect(result.amount).toBe(100);
      expect(result.fee).toBe(1);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.paymentMethod).toBe(0);
      expect(result.paymentMethodDescription).toBe('Papara Balance');
    });

    it('should throw validation error for invalid transaction ID', async () => {
      await expect(paparaService.getPaymentStatus('')).rejects.toThrow(PaparaValidationError);
      await expect(paparaService.getPaymentStatus(null)).rejects.toThrow(PaparaValidationError);
      expect(mockClient.paymentService.getPayment).not.toHaveBeenCalled();
    });

    it('should throw API error when status check fails', async () => {
      const mockError = {
        succeeded: false,
        error: {
          message: 'Transaction not found',
          code: 'TRANSACTION_NOT_FOUND'
        }
      };

      mockClient.paymentService.getPayment.mockResolvedValue(mockError);

      await expect(paparaService.getPaymentStatus('invalid123')).rejects.toThrow(PaparaAPIError);
    });
  });

  describe('getAccountBalance', () => {
    it('should get account balance successfully via the Papara API', async () => {
      const mockBalance = {
        succeeded: true,
        data: {
          balance: 10000,
          currency: 'TRY',
          accountNumber: '1234567890',
          merchantId: 'merchant123'
        }
      };

      mockClient.accountService.getAccount.mockResolvedValue(mockBalance);

      const result = await paparaService.getAccountBalance();

      expect(result.success).toBe(true);
      expect(result.balance).toBe(10000);
      expect(result.currency).toBe('TRY');
      expect(result.accountNumber).toBe('1234567890');
      expect(result.merchantId).toBe('merchant123');
    });

    it('should throw API error when balance check fails', async () => {
      const mockError = {
        succeeded: false,
        error: {
          message: 'Unauthorized',
          code: 'UNAUTHORIZED'
        }
      };

      mockClient.accountService.getAccount.mockResolvedValue(mockError);

      await expect(paparaService.getAccountBalance()).rejects.toThrow(PaparaAPIError);
    });
  });

  describe('_mapPaymentStatus', () => {
    it('should map payment status codes correctly', () => {
      expect(paparaService._mapPaymentStatus(0)).toBe('pending');
      expect(paparaService._mapPaymentStatus(1)).toBe('completed');
      expect(paparaService._mapPaymentStatus(2)).toBe('refunded');
      expect(paparaService._mapPaymentStatus(999)).toBe('unknown');
    });
  });

  describe('Error Classes', () => {
    it('should create PaparaAPIError with message and code', () => {
      const error = new PaparaAPIError('Test error', 'TEST_CODE');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('PaparaAPIError');
    });

    it('should create PaparaValidationError with message', () => {
      const error = new PaparaValidationError('Validation failed');
      expect(error.message).toBe('Validation failed');
      expect(error.name).toBe('PaparaValidationError');
    });

    it('should create PaparaInsufficientFundsError with message', () => {
      const error = new PaparaInsufficientFundsError('Insufficient funds');
      expect(error.message).toBe('Insufficient funds');
      expect(error.name).toBe('PaparaInsufficientFundsError');
    });
  });
});
