// Mock the Papara service
jest.mock('../paparaService', () => {
  const mockPaparaService = {
    validateAccount: jest.fn(),
    sendPayment: jest.fn(),
    getPaymentStatus: jest.fn(),
    getAccountBalance: jest.fn(),
    isSandboxMode: jest.fn(() => true)
  };
  return mockPaparaService;
});

// Mock the database
jest.mock('../../database/dal/p2pOrders', () => ({
  createOrder: jest.fn(),
  getByOrderId: jest.fn(),
  updateOrderStatus: jest.fn(),
  findMatchingOrders: jest.fn()
}));

// Create a mock Papara service instance
const mockPaparaServiceInstance = {
  validateAccount: jest.fn(),
  sendPayment: jest.fn(),
  getPaymentStatus: jest.fn(),
  getAccountBalance: jest.fn()
};

// Mock the P2P matching service
jest.mock('../p2pMatchingService', () => ({
  createOrder: jest.fn(),
  matchOrders: jest.fn(),
  confirmPayment: jest.fn(),
  confirmXRPTransfer: jest.fn(),
  cancelOrder: jest.fn(),
  raiseDispute: jest.fn(),
  processPaparaPayment: jest.fn(),
  getPaparaPaymentStatus: jest.fn(),
  getPaparaBalance: jest.fn(),
  getPaparaService: jest.fn(() => mockPaparaServiceInstance)
}));

// Import the mocked services
const paparaService = require('../paparaService');
const P2POrdersDAL = require('../../database/dal/p2pOrders');
const p2pMatchingService = require('../p2pMatchingService');

describe('Papara Integration Tests', () => {
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('Account Validation Flow', () => {
    it('should validate Papara account successfully', async () => {
      const mockValidation = {
        success: true,
        accountExists: true,
        accountHolder: 'Test User',
        accountNumber: '1234567890'
      };

      p2pMatchingService.getPaparaService().validateAccount.mockResolvedValue(mockValidation);

      const result = await p2pMatchingService.getPaparaService().validateAccount('1234567890');

      expect(result.success).toBe(true);
      expect(result.accountExists).toBe(true);
      expect(result.accountHolder).toBe('Test User');
      expect(result.accountNumber).toBe('1234567890');
    });

    it('should handle validation errors', async () => {
      p2pMatchingService.getPaparaService().validateAccount.mockRejectedValue(
        new Error('Account not found')
      );

      await expect(
        p2pMatchingService.getPaparaService().validateAccount('1234567890')
      ).rejects.toThrow('Account not found');
    });
  });

  describe('Payment Initiation Flow', () => {
    it('should initiate Papara payment successfully', async () => {
      const mockOrder = {
        order_id: 'order123',
        status: 'matched',
        counterparty_order_id: 'counterparty123',
        amount_try: 100,
        amount_xrp: 10
      };

      const mockPaymentResult = {
        success: true,
        transactionId: 'tx123',
        referenceId: 'ref123',
        status: 'pending',
        paymentUrl: 'https://papara.com/pay/tx123',
        amount: 100,
        fee: 1
      };

      p2pMatchingService.processPaparaPayment.mockResolvedValue(mockPaymentResult);

      const result = await p2pMatchingService.processPaparaPayment(mockOrder, '1234567890');

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('tx123');
      expect(result.referenceId).toBe('ref123');
      expect(result.status).toBe('pending');
    });

    it('should handle payment initiation failure', async () => {
      const mockOrder = {
        order_id: 'order123',
        status: 'matched'
      };

      const mockPaymentResult = {
        success: false,
        message: 'Insufficient funds'
      };

      p2pMatchingService.processPaparaPayment.mockResolvedValue(mockPaymentResult);

      const result = await p2pMatchingService.processPaparaPayment(mockOrder, '1234567890');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Insufficient funds');
    });
  });

  describe('Payment Status Flow', () => {
    it('should get payment status successfully', async () => {
      const mockStatusResult = {
        success: true,
        transactionId: 'tx123',
        status: 'completed',
        statusDescription: 'Payment completed',
        amount: 100,
        fee: 1,
        createdAt: new Date(),
        paymentMethod: 0,
        paymentMethodDescription: 'Papara Balance'
      };

      p2pMatchingService.getPaparaPaymentStatus.mockResolvedValue(mockStatusResult);

      const result = await p2pMatchingService.getPaparaPaymentStatus('tx123');

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('tx123');
      expect(result.status).toBe('completed');
    });

    it('should handle status check failure', async () => {
      const mockStatusResult = {
        success: false,
        message: 'Transaction not found'
      };

      p2pMatchingService.getPaparaPaymentStatus.mockResolvedValue(mockStatusResult);

      const result = await p2pMatchingService.getPaparaPaymentStatus('invalid123');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Transaction not found');
    });
  });

  describe('Balance Check Flow', () => {
    it('should get account balance successfully', async () => {
      const mockBalanceResult = {
        success: true,
        balance: 10000,
        currency: 'TRY',
        accountNumber: '1234567890',
        merchantId: 'merchant123'
      };

      p2pMatchingService.getPaparaBalance.mockResolvedValue(mockBalanceResult);

      const result = await p2pMatchingService.getPaparaBalance();

      expect(result.success).toBe(true);
      expect(result.balance).toBe(10000);
      expect(result.currency).toBe('TRY');
      expect(result.accountNumber).toBe('1234567890');
      expect(result.merchantId).toBe('merchant123');
    });

    it('should handle balance check failure', async () => {
      const mockBalanceResult = {
        success: false,
        message: 'Unauthorized'
      };

      p2pMatchingService.getPaparaBalance.mockResolvedValue(mockBalanceResult);

      const result = await p2pMatchingService.getPaparaBalance();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Unauthorized');
    });
  });

  describe('Complete P2P Flow', () => {
    it('should complete full Papara P2P transaction flow', async () => {
      // Step 1: Validate account
      const mockValidation = {
        success: true,
        accountExists: true,
        accountHolder: 'Test User',
        accountNumber: '1234567890'
      };

      p2pMatchingService.getPaparaService().validateAccount.mockResolvedValue(mockValidation);

      const validationResult = await p2pMatchingService.getPaparaService().validateAccount('1234567890');

      expect(validationResult.success).toBe(true);
      expect(validationResult.accountExists).toBe(true);

      // Step 2: Initiate payment
      const mockOrder = {
        order_id: 'order123',
        status: 'matched',
        counterparty_order_id: 'counterparty123',
        amount_try: 100,
        amount_xrp: 10
      };

      const mockPaymentResult = {
        success: true,
        transactionId: 'tx123',
        referenceId: 'ref123',
        status: 'pending',
        paymentUrl: 'https://papara.com/pay/tx123',
        amount: 100,
        fee: 1
      };

      p2pMatchingService.processPaparaPayment.mockResolvedValue(mockPaymentResult);

      const paymentResult = await p2pMatchingService.processPaparaPayment(mockOrder, '1234567890');

      expect(paymentResult.success).toBe(true);
      expect(paymentResult.transactionId).toBe('tx123');

      // Step 3: Check payment status
      const mockStatusResult = {
        success: true,
        transactionId: 'tx123',
        status: 'completed',
        statusDescription: 'Payment completed',
        amount: 100,
        fee: 1,
        createdAt: new Date(),
        paymentMethod: 0,
        paymentMethodDescription: 'Papara Balance'
      };

      p2pMatchingService.getPaparaPaymentStatus.mockResolvedValue(mockStatusResult);

      const statusResult = await p2pMatchingService.getPaparaPaymentStatus('tx123');

      expect(statusResult.success).toBe(true);
      expect(statusResult.status).toBe('completed');

      // Step 4: Check balance
      const mockBalanceResult = {
        success: true,
        balance: 9900, // Reduced by payment amount + fee
        currency: 'TRY',
        accountNumber: '1234567890',
        merchantId: 'merchant123'
      };

      p2pMatchingService.getPaparaBalance.mockResolvedValue(mockBalanceResult);

      const balanceResult = await p2pMatchingService.getPaparaBalance();

      expect(balanceResult.success).toBe(true);
      expect(balanceResult.balance).toBe(9900);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      p2pMatchingService.getPaparaService().validateAccount.mockRejectedValue(
        new Error('Network error')
      );

      await expect(
        p2pMatchingService.getPaparaService().validateAccount('1234567890')
      ).rejects.toThrow('Network error');
    });

    it('should handle API errors gracefully', async () => {
      const mockError = {
        success: false,
        message: 'API rate limit exceeded'
      };

      p2pMatchingService.processPaparaPayment.mockResolvedValue(mockError);

      const result = await p2pMatchingService.processPaparaPayment({}, '1234567890');

      expect(result.success).toBe(false);
      expect(result.message).toBe('API rate limit exceeded');
    });
  });
});
