/**
 * Unit tests for burnerWalletService
 */

const { generateSeed, deriveKeypair, deriveAddress } = require('ripple-keypairs');

// Dynamically generate mock addresses and seeds starting with 'mock' to satisfy Jest's scoping rules
const mockSponsorSeed = generateSeed();
const mockSponsorKeypair = deriveKeypair(mockSponsorSeed);
const mockSponsorAddress = deriveAddress(mockSponsorKeypair.publicKey);

const mockBurnerSeed = generateSeed();
const mockBurnerKeypair = deriveKeypair(mockBurnerSeed);
const mockBurnerAddress = deriveAddress(mockBurnerKeypair.publicKey);

// Set environmental variables before importing anything
process.env.SPONSOR_SEED = mockSponsorSeed;
process.env.SPONSOR_ADDRESS = mockSponsorAddress;
process.env.JWT_SECRET = 'test_only_jwt_secret_not_for_production';

// Mock connection module
jest.mock('../../database/connection', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn()
  }
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  logP2P: jest.fn()
}));

// Mock WalletsDAL and SystemSettingsDAL
jest.mock('../../database/dal', () => ({
  WalletsDAL: {
    create: jest.fn()
  },
  SystemSettingsDAL: {
    getAll: jest.fn()
  }
}));

const xrpl = require('xrpl');
const jwt = require('jsonwebtoken');
const { pool } = require('../../database/connection');
const { WalletsDAL, SystemSettingsDAL } = require('../../database/dal');
const logger = require('../../utils/logger');
const burnerWalletService = require('../burnerWalletService');

// Mock xrpl Client
const mockClientInstance = {
  connect: jest.fn().mockResolvedValue(),
  disconnect: jest.fn().mockResolvedValue(),
  autofill: jest.fn().mockImplementation(async (tx) => ({ ...tx, Fee: '12' })),
  submit: jest.fn().mockResolvedValue({ result: { engine_result: 'tesSUCCESS' } }),
  request: jest.fn().mockImplementation(async (req) => {
    if (req.command === 'server_state') {
      return {
        result: {
          state: {
            validated_ledger: {
              reserve_base: 1000000 // 1 XRP in drops
            }
          }
        }
      };
    }
    if (req.command === 'tx') {
      return {
        result: {
          validated: true,
          meta: {
            TransactionResult: 'tesSUCCESS'
          }
        }
      };
    }
    return { result: {} };
  })
};

// Mock xrpl Wallet
const mockSponsorWallet = {
  classicAddress: mockSponsorAddress,
  publicKey: mockSponsorKeypair.publicKey,
  privateKey: mockSponsorKeypair.privateKey,
  sign: jest.fn().mockReturnValue({ tx_blob: 'signed_sponsor_blob', hash: 'sponsor_tx_hash' })
};

const mockBurnerWallet = {
  classicAddress: mockBurnerAddress,
  address: mockBurnerAddress,
  seed: mockBurnerSeed,
  publicKey: mockBurnerKeypair.publicKey,
  privateKey: mockBurnerKeypair.privateKey,
  sign: jest.fn().mockReturnValue({ tx_blob: 'signed_burner_blob', hash: 'burner_tx_hash' })
};

// Apply mocks to window.xrpl & node-xrpl
jest.mock('xrpl', () => {
  return {
    Client: jest.fn().mockImplementation(() => mockClientInstance),
    Wallet: {
      generate: jest.fn().mockImplementation(() => mockBurnerWallet),
      fromSeed: jest.fn().mockImplementation((seed) => {
        if (seed === process.env.SPONSOR_SEED) return mockSponsorWallet;
        if (seed === mockBurnerSeed) return mockBurnerWallet;
        return { classicAddress: seed };
      })
    }
  };
});

describe('BurnerWalletService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    burnerWalletService.stopSweeper();
    burnerWalletService.seeds.clear();

    mockClientInstance.submit.mockReset();
    mockClientInstance.submit.mockResolvedValue({ result: { engine_result: 'tesSUCCESS' } });

    mockClientInstance.request.mockReset();
    mockClientInstance.request.mockImplementation(async (req) => {
      if (req.command === 'server_state') {
        return {
          result: {
            state: {
              validated_ledger: {
                reserve_base: 1000000
              }
            }
          }
        };
      }
      if (req.command === 'tx') {
        return {
          result: {
            validated: true,
            meta: {
              TransactionResult: 'tesSUCCESS'
            }
          }
        };
      }
      return { result: {} };
    });

    // Default system settings mock values
    SystemSettingsDAL.getAll.mockResolvedValue({
      sponsor_seed: mockSponsorSeed,
      sponsor_address: mockSponsorAddress,
      burner_sweep_interval_ms: '60000',
      burner_destroy_delay_ms: '960000'
    });
  });

  describe('createBurner', () => {
    it('creates, funds, remembers seed, upserts DB tables, and issues JWT', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // INSERT into burner_wallets
      WalletsDAL.create.mockResolvedValue({ address: mockBurnerAddress });

      const result = await burnerWalletService.createBurner();

      // Check return payload
      expect(result.address).toBe(mockBurnerAddress);
      expect(result.seed).toBe(mockBurnerSeed);
      expect(result.reserveXrp).toBe(1);
      expect(result.token).toBeDefined();

      // Check in-memory seed was recorded
      expect(burnerWalletService._seedFor(mockBurnerAddress)).toBe(mockBurnerSeed);

      // Check DB upserts
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO burner_wallets'),
        [mockBurnerAddress]
      );
      expect(WalletsDAL.create).toHaveBeenCalledWith({
        address: mockBurnerAddress,
        public_key: mockBurnerWallet.publicKey,
        is_active: true,
        role: 'buyer'
      });

      // Verify JWT payload
      const decoded = jwt.verify(result.token, process.env.JWT_SECRET);
      expect(decoded.address).toBe(mockBurnerAddress);
      expect(decoded.role).toBe('buyer');
      expect(decoded.burner).toBe(true);

      // Verify xrpl calls
      expect(mockClientInstance.connect).toHaveBeenCalled();
      expect(mockClientInstance.autofill).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactionType: 'Payment',
          Account: mockSponsorAddress,
          Destination: mockBurnerAddress,
          Amount: '1000000'
        })
      );
      expect(mockSponsorWallet.sign).toHaveBeenCalled();
      expect(mockClientInstance.submit).toHaveBeenCalledWith('signed_sponsor_blob');
    });

    it('throws if SPONSOR_SEED is missing', async () => {
      SystemSettingsDAL.getAll.mockResolvedValue({
        sponsor_seed: '',
        sponsor_address: '',
        burner_sweep_interval_ms: '60000',
        burner_destroy_delay_ms: '960000'
      });
      const originalSeed = process.env.SPONSOR_SEED;
      delete process.env.SPONSOR_SEED;

      await expect(burnerWalletService.createBurner()).rejects.toThrow('SPONSOR_SEED is not configured');

      process.env.SPONSOR_SEED = originalSeed;
    });

    it('throws if SPONSOR_ADDRESS does not match derived address', async () => {
      const mismatchedSeed = generateSeed();
      const mismatchedAddress = deriveAddress(deriveKeypair(mismatchedSeed).publicKey);
      SystemSettingsDAL.getAll.mockResolvedValue({
        sponsor_seed: mockSponsorSeed,
        sponsor_address: mismatchedAddress,
        burner_sweep_interval_ms: '60000',
        burner_destroy_delay_ms: '960000'
      });
      await expect(burnerWalletService.createBurner()).rejects.toThrow('SPONSOR_ADDRESS does not match the derived address of SPONSOR_SEED');
    });

    it('throws if funding fails', async () => {
      mockClientInstance.submit.mockResolvedValueOnce({ result: { engine_result: 'tefALREADY' } });
      await expect(burnerWalletService.createBurner()).rejects.toThrow('Sponsor payment failed');
    });

    it('throws if reserveBase cannot be read', async () => {
      mockClientInstance.request.mockImplementationOnce(async (req) => {
        if (req.command === 'server_state') {
          return { result: { state: { validated_ledger: {} } } };
        }
        return { result: {} };
      });
      await expect(burnerWalletService.createBurner()).rejects.toThrow('Could not read reserve_base');
    });

    it('throws if transaction is not validated in time', async () => {
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = jest.fn().mockImplementation((cb) => cb());
      
      try {
        mockClientInstance.request.mockImplementation(async (req) => {
          if (req.command === 'server_state') {
            return { result: { state: { validated_ledger: { reserve_base: 1000000 } } } };
          }
          if (req.command === 'tx') {
            return { result: { validated: false } };
          }
          return { result: {} };
        });
        await expect(burnerWalletService.createBurner()).rejects.toThrow('Transaction not validated in time');
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    });

    it('rethrows unknown errors in waitForValidation', async () => {
      mockClientInstance.request.mockImplementation(async (req) => {
        if (req.command === 'server_state') {
          return { result: { state: { validated_ledger: { reserve_base: 1000000 } } } };
        }
        if (req.command === 'tx') {
          throw new Error('Connection lost');
        }
        return { result: {} };
      });
      await expect(burnerWalletService.createBurner()).rejects.toThrow('Connection lost');
    });

    it('succeeds when sponsor_address is not configured in settings (optional field)', async () => {
      SystemSettingsDAL.getAll.mockResolvedValueOnce({
        sponsor_seed: mockSponsorSeed,
        sponsor_address: '',
        burner_sweep_interval_ms: '60000',
        burner_destroy_delay_ms: '960000'
      });
      pool.query.mockResolvedValueOnce({ rows: [] }); // INSERT into burner_wallets
      WalletsDAL.create.mockResolvedValue({ address: mockBurnerAddress });

      const result = await burnerWalletService.createBurner();
      expect(result.address).toBe(mockBurnerAddress);
    });
  });

  describe('getBurner and markOrderSettled', () => {
    it('getBurner queries the DB row', async () => {
      const mockRow = { address: mockBurnerAddress, status: 'active' };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await burnerWalletService.getBurner(mockBurnerAddress);
      expect(result).toEqual(mockRow);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT address, order_id'),
        [mockBurnerAddress]
      );
    });

    it('markOrderSettled updates status and order_id in database', async () => {
      const mockRow = { address: mockBurnerAddress, order_id: 'order-123', status: 'sweep_pending' };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await burnerWalletService.markOrderSettled(mockBurnerAddress, 'order-123');
      expect(result).toEqual(mockRow);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE burner_wallets'),
        [mockBurnerAddress, 'order-123']
      );
    });
  });

  describe('destroyBurner', () => {
    it('returns false if seed is not in memory', async () => {
      const result = await burnerWalletService.destroyBurner(mockBurnerAddress);
      expect(result).toBe(false);
    });

    it('submits AccountDelete on success, updates status, and discards seed', async () => {
      // Setup seed in memory
      burnerWalletService._rememberSeed(mockBurnerAddress, mockBurnerSeed);

      pool.query.mockResolvedValueOnce({ rows: [] }); // UPDATE burner_wallets status

      const result = await burnerWalletService.destroyBurner(mockBurnerAddress);

      expect(result).toBe(true);
      expect(burnerWalletService._seedFor(mockBurnerAddress)).toBeNull();

      expect(mockClientInstance.autofill).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactionType: 'AccountDelete',
          Account: mockBurnerAddress,
          Destination: mockSponsorAddress
        })
      );
      expect(mockBurnerWallet.sign).toHaveBeenCalled();
      expect(mockClientInstance.submit).toHaveBeenCalledWith('signed_burner_blob', { failHard: true });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE burner_wallets'),
        [mockBurnerAddress]
      );
    });

    it('returns false and defers on tecTOO_SOON or ledger error', async () => {
      burnerWalletService._rememberSeed(mockBurnerAddress, mockBurnerSeed);

      mockClientInstance.submit.mockResolvedValueOnce({
        result: {
          engine_result: 'tecTOO_SOON',
          engine_result_message: 'Account not old enough'
        }
      });

      const result = await burnerWalletService.destroyBurner(mockBurnerAddress);

      expect(result).toBe(false);
      // Seed should remain in memory for future retry
      expect(burnerWalletService._seedFor(mockBurnerAddress)).toBe(mockBurnerSeed);
    });

    it('throws if seed classicAddress does not match address', async () => {
      burnerWalletService._rememberSeed(mockBurnerAddress, mockSponsorSeed);
      await expect(burnerWalletService.destroyBurner(mockBurnerAddress)).rejects.toThrow('Burner seed does not match its address');
    });

    it('throws if destination address matches the burner address itself', async () => {
      burnerWalletService._rememberSeed(mockBurnerAddress, mockBurnerSeed);
      SystemSettingsDAL.getAll.mockResolvedValueOnce({
        sponsor_seed: mockSponsorSeed,
        sponsor_address: mockBurnerAddress,
        burner_sweep_interval_ms: '60000',
        burner_destroy_delay_ms: '960000'
      });
      await expect(burnerWalletService.destroyBurner(mockBurnerAddress)).rejects.toThrow('AccountDelete destination cannot be the burner itself');
    });
  });

  describe('_seedFor expiry and eviction', () => {
    it('evicts and returns null if the seed is expired', () => {
      burnerWalletService.seeds.set(mockBurnerAddress, {
        seed: mockBurnerSeed,
        expiresAt: Date.now() - 1000
      });
      expect(burnerWalletService._seedFor(mockBurnerAddress)).toBeNull();
      expect(burnerWalletService.seeds.has(mockBurnerAddress)).toBe(false);
    });
  });

  describe('_isSweepEligible', () => {
    it('returns true if no order_id is associated', async () => {
      const eligible = await burnerWalletService._isSweepEligible({ address: mockBurnerAddress });
      expect(eligible).toBe(true);
    });

    it('returns true if associated order does not exist in DB', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const eligible = await burnerWalletService._isSweepEligible({ address: mockBurnerAddress, order_id: 'nonexistent' });
      expect(eligible).toBe(true);
    });

    it('returns true if order is in terminal status (completed, cancelled, expired)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ status: 'completed' }] });
      const eligible = await burnerWalletService._isSweepEligible({ address: mockBurnerAddress, order_id: 'order-1' });
      expect(eligible).toBe(true);
    });

    it('returns false if order is still open or matched', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ status: 'matched' }] });
      const eligible = await burnerWalletService._isSweepEligible({ address: mockBurnerAddress, order_id: 'order-2' });
      expect(eligible).toBe(false);
    });
  });

  describe('Sweeper control and runSweep', () => {
    it('runSweep calls destroyBurner for eligible burners', async () => {
      const mockBurners = [
        { address: mockBurnerAddress, order_id: 'order-1', status: 'active' },
        { address: 'rOtherAddress', order_id: 'order-2', status: 'sweep_pending' }
      ];
      pool.query.mockResolvedValueOnce({ rows: mockBurners }); // SELECT in runSweep

      // Mock _isSweepEligible
      jest.spyOn(burnerWalletService, '_isSweepEligible').mockImplementation(async (b) => {
        return b.address === mockBurnerAddress; // only first is eligible
      });

      // Mock destroyBurner
      jest.spyOn(burnerWalletService, 'destroyBurner').mockResolvedValue(true);

      await burnerWalletService.runSweep();

      expect(burnerWalletService._isSweepEligible).toHaveBeenCalledTimes(2);
      expect(burnerWalletService.destroyBurner).toHaveBeenCalledWith(mockBurnerAddress);
      expect(burnerWalletService.destroyBurner).not.toHaveBeenCalledWith('rOtherAddress');
    });

    it('continues sweeping other wallets if one destroy fails', async () => {
      const mockBurners = [
        { address: mockBurnerAddress, order_id: 'order-1', status: 'active' },
        { address: 'rOtherAddress', order_id: 'order-2', status: 'sweep_pending' }
      ];
      pool.query.mockResolvedValueOnce({ rows: mockBurners }); // SELECT in runSweep

      jest.spyOn(burnerWalletService, '_isSweepEligible').mockImplementation(async () => true);

      // Make first fail, second succeed
      jest.spyOn(burnerWalletService, 'destroyBurner')
        .mockRejectedValueOnce(new Error('Destroy failed'))
        .mockResolvedValueOnce(true);

      await burnerWalletService.runSweep();

      expect(burnerWalletService.destroyBurner).toHaveBeenCalledTimes(2);
    });

    it('startSweeper schedules timeout and stopSweeper clears it', async () => {
      expect(burnerWalletService.sweepTimer).toBeNull();
      burnerWalletService.startSweeper();
      
      // Wait for promise resolution
      await new Promise(resolve => setImmediate(resolve));
      
      expect(burnerWalletService.sweepTimer).not.toBeNull();

      burnerWalletService.stopSweeper();
      expect(burnerWalletService.sweepTimer).toBeNull();
    });

    it('returns the existing timer if startSweeper is called twice', () => {
      burnerWalletService.sweepTimer = 'mock_timer';
      const timer = burnerWalletService.startSweeper();
      expect(timer).toBe('mock_timer');
      burnerWalletService.sweepTimer = null; // cleanup
    });

    it('logs error if startSweeper bootstrap fails', async () => {
      SystemSettingsDAL.getAll.mockRejectedValueOnce(new Error('DB connection failed'));
      
      const originalSeed = process.env.SPONSOR_SEED;
      delete process.env.SPONSOR_SEED;
      
      try {
        burnerWalletService.startSweeper();
        await new Promise(resolve => setImmediate(resolve));
        
        expect(logger.error).toHaveBeenCalledWith(
          'Failed to bootstrap burner sweeper',
          expect.any(Object)
        );
      } finally {
        process.env.SPONSOR_SEED = originalSeed;
      }
    });

    it('uses env fallbacks in getBurnerSettings if DB query fails', async () => {
      SystemSettingsDAL.getAll.mockRejectedValueOnce(new Error('DB failure'));
      
      const originalInterval = process.env.BURNER_SWEEP_INTERVAL_MS;
      delete process.env.BURNER_SWEEP_INTERVAL_MS;

      burnerWalletService.startSweeper();
      await new Promise(resolve => setImmediate(resolve));

      expect(burnerWalletService.sweepTimer).not.toBeNull();
      burnerWalletService.stopSweeper();
      
      process.env.BURNER_SWEEP_INTERVAL_MS = originalInterval;
    });

    it('does not reschedule sweeper if stopSweeper is called during run', async () => {
      SystemSettingsDAL.getAll.mockResolvedValue({
        sponsor_seed: mockSponsorSeed,
        sponsor_address: mockSponsorAddress,
        burner_sweep_interval_ms: '5',
        burner_destroy_delay_ms: '960000'
      });

      jest.spyOn(burnerWalletService, 'runSweep').mockImplementationOnce(async () => {
        burnerWalletService.stopSweeper();
      });
      
      burnerWalletService.startSweeper();
      
      // Wait 15ms for the sweeper to boot, run once, and call stopSweeper
      await new Promise(resolve => setTimeout(resolve, 15));
      
      expect(burnerWalletService.sweepTimer).toBeNull();
    });

    it('warns and does not start sweeper if sponsorSeed is missing', async () => {
      SystemSettingsDAL.getAll.mockResolvedValueOnce({
        sponsor_seed: '',
        sponsor_address: '',
        burner_sweep_interval_ms: '60000',
        burner_destroy_delay_ms: '960000'
      });
      
      const originalSeed = process.env.SPONSOR_SEED;
      delete process.env.SPONSOR_SEED;
      
      try {
        burnerWalletService.startSweeper();
        await new Promise(resolve => setImmediate(resolve));
        
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('sponsor_seed is not configured')
        );
        expect(burnerWalletService.sweepTimer).toBeNull();
      } finally {
        process.env.SPONSOR_SEED = originalSeed;
      }
    });

    it('logs error if runSweep fails inside the sweeper timer', async () => {
      SystemSettingsDAL.getAll.mockResolvedValue({
        sponsor_seed: mockSponsorSeed,
        sponsor_address: mockSponsorAddress,
        burner_sweep_interval_ms: '5',
        burner_destroy_delay_ms: '960000'
      });

      jest.spyOn(burnerWalletService, 'runSweep').mockRejectedValueOnce(new Error('Sweep fatal error'));
      
      burnerWalletService.startSweeper();
      
      await new Promise(resolve => setTimeout(resolve, 15));
      
      expect(logger.error).toHaveBeenCalledWith(
        'Burner sweep pass failed',
        expect.any(Object)
      );
      
      burnerWalletService.stopSweeper();
    });

    it('reschedules sweeper timeout if active', async () => {
      SystemSettingsDAL.getAll.mockResolvedValue({
        sponsor_seed: mockSponsorSeed,
        sponsor_address: mockSponsorAddress,
        burner_sweep_interval_ms: '5',
        burner_destroy_delay_ms: '960000'
      });

      jest.spyOn(burnerWalletService, 'runSweep').mockResolvedValue(true);
      
      burnerWalletService.startSweeper();
      
      await new Promise(resolve => setTimeout(resolve, 15));
      
      expect(burnerWalletService.sweepTimer).not.toBeNull();
      
      burnerWalletService.stopSweeper();
    });
  });
});
