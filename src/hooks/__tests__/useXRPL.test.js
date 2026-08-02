/**
 * @jest-environment jsdom
 *
 * Unit tests for the useXRPL hook (current Phase-4 contract).
 *
 * Rewritten in Phase 7 (PRD 7.1.1): the legacy suite asserted pre-Phase-4
 * behavior (hardcoded http://127.0.0.1:5001 apiBaseUrl, server-fetched
 * wallet seeds, pre-fix sendPayment). This suite covers the current hook:
 * origin-based apiBaseUrl, encrypted client-side wallet storage, auth
 * auto-login, and the guarded sendPayment flow. The 4.4 correctness fixes
 * are covered in useXRPL-4.4.test.js.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { notice } from '../../services/notice';
import { useXRPL, XRPLProvider } from '../useXRPL';
import authService from '../../services/authService';
import {
  saveWalletEncrypted,
  loadWalletEncrypted,
  hasStoredWallet,
  getStoredWalletAddress,
  clearStoredWallet
} from '../../services/walletStorage';

jest.mock('../../services/authService', () => ({
  __esModule: true,
  default: {
    login: jest.fn().mockResolvedValue({ token: 't' }),
    authFetch: jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, wallets: [{ role: 'seller' }] }) }),
    getToken: jest.fn().mockReturnValue('t'),
    logout: jest.fn(),
    setBaseUrl: jest.fn()
  }
}));

jest.mock('../../services/walletStorage', () => ({
  saveWalletEncrypted: jest.fn().mockResolvedValue(),
  loadWalletEncrypted: jest.fn(),
  hasStoredWallet: jest.fn().mockReturnValue(false),
  getStoredWalletAddress: jest.fn().mockReturnValue(null),
  clearStoredWallet: jest.fn()
}));

const wrapper = ({ children }) => <XRPLProvider>{children}</XRPLProvider>;

const mockWallet = {
  address: 'rJv1Fb8XG2V9twNJa2sJ3uKaZS6xQxeuns',
  seed: 'sn3nxiW7v8KXzPzAqzzy7sz6SZQ2h',
  publicKey: 'ED' + 'A'.repeat(64),
  privateKey: 'ED' + 'B'.repeat(64),
  sign: jest.fn().mockReturnValue({ tx_blob: 'signed_tx', hash: 'tx_hash_123' })
};

function makeClient(overrides = {}) {
  return {
    connect: jest.fn().mockResolvedValue(),
    disconnect: jest.fn(),
    getXrpBalance: jest.fn().mockResolvedValue('1000'),
    fundWallet: jest.fn().mockResolvedValue({ balance: '1000' }),
    autofill: jest.fn().mockResolvedValue({ Fee: '12' }),
    submit: jest.fn().mockResolvedValue({ result: { engine_result: 'tesSUCCESS' } }),
    request: jest.fn().mockResolvedValue({
      result: {
        info: { validated_ledger: { base_reserve_xrp: '10000000' } },
        validated: true,
        meta: { TransactionResult: 'tesSUCCESS' }
      }
    }),
    ...overrides
  };
}

function installXrpl(client) {
  global.window.xrpl = {
    Client: jest.fn().mockImplementation(() => client),
    Wallet: {
      generate: jest.fn().mockReturnValue(mockWallet),
      fromSeed: jest.fn().mockReturnValue(mockWallet)
    },
    xrpToDrops: jest.fn().mockReturnValue('1000000'),
    dropsToXrp: jest.fn().mockReturnValue('10'),
    convertStringToHex: jest.fn().mockReturnValue('48656c6c6f')
  };
}

describe('useXRPL hook (current contract)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.prompt = jest.fn().mockReturnValue(''); // skip encrypted save
    delete process.env.REACT_APP_API_URL;
    delete process.env.REACT_APP_WS_URL;
    delete process.env.REACT_APP_XRPL_NETWORK;
  });

  describe('apiBaseUrl / wsBaseUrl (M2 origin-based contract)', () => {
    it('throws when used outside the XRPLProvider', () => {
      expect(() => renderHook(() => useXRPL())).toThrow(
        'useXRPL must be used within an XRPLProvider'
      );
    });

    it('uses window.location.origin by default (CSP self-safe)', async () => {
      installXrpl(makeClient());
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await act(async () => { await Promise.resolve(); });

      expect(result.current.apiBaseUrl).toBe(window.location.origin);
      expect(result.current.apiBaseUrl).not.toContain('127.0.0.1');
      expect(result.current.wsBaseUrl).toBe(
        window.location.origin.replace(/^http/, 'ws')
      );
    });

    it('honors REACT_APP_API_URL / REACT_APP_WS_URL when set', async () => {
      process.env.REACT_APP_API_URL = 'https://api.example.com';
      process.env.REACT_APP_WS_URL = 'wss://ws.example.com';
      installXrpl(makeClient());
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await act(async () => { await Promise.resolve(); });

      expect(result.current.apiBaseUrl).toBe('https://api.example.com');
      expect(result.current.wsBaseUrl).toBe('wss://ws.example.com');
    });
  });

  describe('connectToXRPL', () => {
    it('connects and returns the client on success', async () => {
      const client = makeClient();
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let returned;
      await act(async () => {
        returned = await result.current.connectToXRPL();
      });

      expect(returned).toBe(client);
      expect(client.connect).toHaveBeenCalled();
      expect(result.current.isConnected).toBe(true);
    });

    it('returns null and toasts on connection failure', async () => {
      const client = makeClient({
        connect: jest.fn().mockRejectedValue(new Error('network down'))
      });
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let returned;
      await act(async () => {
        returned = await result.current.connectToXRPL();
      });

      expect(returned).toBeNull();
      expect(result.current.isConnected).toBe(false);
      expect(notice.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to connect to XRPL')
      );
    });

    it('returns null when server info is missing', async () => {
      const client = makeClient({ request: jest.fn().mockResolvedValue({ result: {} }) });
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let returned;
      await act(async () => {
        returned = await result.current.connectToXRPL();
      });

      expect(returned).toBeNull();
    });
  });

  describe('createWallet', () => {
    it('creates, funds, auto-logs-in and syncs address+publicKey (no seed)', async () => {
      const client = makeClient();
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let wallet;
      await act(async () => {
        wallet = await result.current.createWallet();
      });

      expect(wallet).toBe(mockWallet);
      expect(client.fundWallet).toHaveBeenCalledWith(mockWallet);
      expect(authService.login).toHaveBeenCalledWith(mockWallet);

      const syncCall = authService.authFetch.mock.calls.find((c) =>
        String(c[0]).includes('/api/wallets')
      );
      expect(syncCall).toBeDefined();
      const body = JSON.parse(syncCall[1].body);
      expect(body).toEqual({
        address: mockWallet.address,
        publicKey: mockWallet.publicKey
      });
      expect(JSON.stringify(syncCall[1].body)).not.toContain(mockWallet.seed);
    });

    it('saves the wallet encrypted when a password is given', async () => {
      window.prompt = jest.fn().mockReturnValue('wallet-pw');
      installXrpl(makeClient());
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await act(async () => {
        await result.current.createWallet();
      });

      expect(saveWalletEncrypted).toHaveBeenCalledWith(mockWallet, 'wallet-pw');
    });

    it('throws and toasts when funding fails', async () => {
      const client = makeClient({
        fundWallet: jest.fn().mockRejectedValue(new Error('faucet down'))
      });
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let err;
      await act(async () => {
        err = await result.current.createWallet().catch((e) => e);
      });

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('faucet down');
      expect(notice.error).toHaveBeenCalledWith(
        expect.stringContaining('faucet down')
      );
    });

    it('throws when reconnecting during wallet creation fails', async () => {
      const client = makeClient({ request: jest.fn().mockResolvedValue({ result: {} }) });
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await expect(
        act(async () => {
          await result.current.createWallet();
        })
      ).rejects.toThrow('Failed to connect to XRPL');
    });
  });

  describe('loadExistingWallet (encrypted client-side storage only)', () => {
    it('returns false when nothing is stored', async () => {
      installXrpl(makeClient());
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let loaded;
      await act(async () => {
        loaded = await result.current.loadExistingWallet();
      });

      expect(loaded).toBe(false);
      expect(loadWalletEncrypted).not.toHaveBeenCalled();
    });

    it('unlocks from encrypted storage and restores the wallet', async () => {
      hasStoredWallet.mockReturnValue(true);
      getStoredWalletAddress.mockReturnValue(mockWallet.address);
      loadWalletEncrypted.mockResolvedValue({ seed: mockWallet.seed });
      window.prompt = jest.fn().mockReturnValue('wallet-pw');
      installXrpl(makeClient());
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let loaded;
      await act(async () => {
        loaded = await result.current.loadExistingWallet();
      });

      expect(loaded).toBe(true);
      expect(window.xrpl.Wallet.fromSeed).toHaveBeenCalledWith(mockWallet.seed);
      expect(result.current.wallet).toBe(mockWallet);
      expect(authService.login).toHaveBeenCalledWith(mockWallet);
    });

    it('returns false when the password is wrong', async () => {
      hasStoredWallet.mockReturnValue(true);
      loadWalletEncrypted.mockRejectedValue(new Error('Decryption failed'));
      window.prompt = jest.fn().mockReturnValue('wrong-pw');
      installXrpl(makeClient());
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let loaded;
      await act(async () => {
        loaded = await result.current.loadExistingWallet();
      });

      expect(loaded).toBe(false);
      expect(notice.error).toHaveBeenCalledWith(
        expect.stringContaining('Could not unlock wallet')
      );
    });

    it('unlocks a wallet when no live connection exists', async () => {
      hasStoredWallet.mockReturnValue(true);
      getStoredWalletAddress.mockReturnValue(null);
      loadWalletEncrypted.mockResolvedValue({ seed: mockWallet.seed });
      window.prompt = jest.fn().mockReturnValue('wallet-pw');
      const client = makeClient({ request: jest.fn().mockResolvedValue({ result: {} }) });
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let loaded;
      await act(async () => {
        loaded = await result.current.loadExistingWallet();
      });

      expect(loaded).toBe(true);
      expect(result.current.wallet).toBe(mockWallet);
    });

    it('refuses to restore a buyer-role wallet and clears it from the device', async () => {
      hasStoredWallet.mockReturnValue(true);
      getStoredWalletAddress.mockReturnValue(mockWallet.address);
      loadWalletEncrypted.mockResolvedValue({ seed: mockWallet.seed });
      authService.authFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, wallets: [{ role: 'buyer' }] })
      });
      window.prompt = jest.fn().mockReturnValue('wallet-pw');
      installXrpl(makeClient());
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let loaded;
      await act(async () => {
        loaded = await result.current.loadExistingWallet();
      });

      expect(loaded).toBe(false);
      expect(clearStoredWallet).toHaveBeenCalled();
      expect(result.current.wallet).toBeNull();
      expect(result.current.sessionType).toBeNull();
      expect(notice.error).toHaveBeenCalledWith(
        expect.stringContaining('Only seller and admin wallets are recoverable')
      );
    });

    it('refuses to restore when the wallet role cannot be confirmed', async () => {
      hasStoredWallet.mockReturnValue(true);
      getStoredWalletAddress.mockReturnValue(mockWallet.address);
      loadWalletEncrypted.mockResolvedValue({ seed: mockWallet.seed });
      authService.authFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, wallets: [] })
      });
      window.prompt = jest.fn().mockReturnValue('wallet-pw');
      installXrpl(makeClient());
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let loaded;
      await act(async () => {
        loaded = await result.current.loadExistingWallet();
      });

      expect(loaded).toBe(false);
      expect(clearStoredWallet).toHaveBeenCalled();
      expect(result.current.wallet).toBeNull();
    });

    it('restores an admin-role wallet', async () => {
      hasStoredWallet.mockReturnValue(true);
      getStoredWalletAddress.mockReturnValue(mockWallet.address);
      loadWalletEncrypted.mockResolvedValue({ seed: mockWallet.seed });
      authService.authFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, wallets: [{ role: 'admin' }] })
      });
      window.prompt = jest.fn().mockReturnValue('wallet-pw');
      installXrpl(makeClient());
      const { result } = renderHook(() => useXRPL(), { wrapper });

      let loaded;
      await act(async () => {
        loaded = await result.current.loadExistingWallet();
      });

      expect(loaded).toBe(true);
      expect(result.current.sessionType).toBe('seller');
      expect(clearStoredWallet).not.toHaveBeenCalled();
    });
  });

  describe('refreshBalance', () => {
    it('updates the balance from the ledger', async () => {
      const client = makeClient();
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await act(async () => {
        await result.current.createWallet();
      });

      client.getXrpBalance.mockResolvedValue('4321');
      let balance;
      await act(async () => {
        balance = await result.current.refreshBalance();
      });

      expect(balance).toBe('4321');
      expect(result.current.balance).toBe('4321');
    });
  });

  describe('sendPayment guards', () => {
    it('rejects when there is no wallet', async () => {
      installXrpl(makeClient());
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await expect(
        act(async () => {
          await result.current.sendPayment('rDest123456789012345678901234', 10, '');
        })
      ).rejects.toThrow('No wallet available');
    });

    it('rejects a non-positive amount before touching the ledger', async () => {
      const client = makeClient();
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await act(async () => {
        await result.current.createWallet();
      });

      await expect(
        act(async () => {
          await result.current.sendPayment('rDest123456789012345678901234', 0, '');
        })
      ).rejects.toThrow('Amount must be a positive number');
      expect(client.submit).not.toHaveBeenCalled();
    });

    it('throws when the preliminary submit is not tesSUCCESS', async () => {
      const client = makeClient({
        submit: jest.fn().mockResolvedValue({
          result: { engine_result: 'tecPATH_DRY' }
        })
      });
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await act(async () => {
        await result.current.createWallet();
      });

      await expect(
        act(async () => {
          await result.current.sendPayment('rDest123456789012345678901234', 20, '');
        })
      ).rejects.toThrow('Prelim submit failed: tecPATH_DRY');
    });

    it('completes a payment and syncs the transaction to the API', async () => {
      const client = makeClient();
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await act(async () => {
        await result.current.createWallet();
      });

      let payment;
      await act(async () => {
        payment = await result.current.sendPayment('rDest123456789012345678901234', 20, 'memo');
      });

      expect(payment).toEqual({ success: true, hash: 'tx_hash_123' });

      const syncCall = authService.authFetch.mock.calls.find((c) =>
        String(c[0]).includes('/api/transactions')
      );
      expect(syncCall).toBeDefined();
      const body = JSON.parse(syncCall[1].body);
      expect(body).toMatchObject({
        hash: 'tx_hash_123',
        fromAddress: mockWallet.address,
        toAddress: 'rDest123456789012345678901234',
        amountXrp: 20,
        status: 'completed'
      });
    }, 15000);

    it('syncs the fee as zero when the prepared transaction lacks a Fee', async () => {
      const client = makeClient({ autofill: jest.fn().mockResolvedValue({}) });
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await act(async () => {
        await result.current.createWallet();
      });

      let payment;
      await act(async () => {
        payment = await result.current.sendPayment('rDest123456789012345678901234', 20, '');
      });

      expect(payment).toEqual({ success: true, hash: 'tx_hash_123' });
    });

    it('throws when the validated transaction fails on ledger', async () => {
      const client = makeClient({
        request: jest.fn().mockImplementation((req) => {
          if (req.command === 'tx') {
            return Promise.resolve({ result: { validated: true, meta: { TransactionResult: 'tecUNFUNDED' } } });
          }
          return Promise.resolve({
            result: {
              info: { validated_ledger: { base_reserve_xrp: '10000000' } },
              validated: true,
              meta: { TransactionResult: 'tesSUCCESS' }
            }
          });
        })
      });
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await act(async () => {
        await result.current.createWallet();
      });

      await expect(
        act(async () => {
          await result.current.sendPayment('rDest123456789012345678901234', 20, '');
        })
      ).rejects.toThrow('Transaction failed: tecUNFUNDED');
    });
  });

  describe('waitForValidation', () => {
    it('throws after the polling budget is exhausted', async () => {
      const client = makeClient({
        request: jest.fn().mockImplementation(async () => {
          const err = new Error('txnNotFound');
          err.data = { error: 'txnNotFound' };
          throw err;
        })
      });
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await expect(
        result.current.waitForValidation(client, 'H'.repeat(64), {
          maxAttempts: 2,
          delayMs: 1
        })
      ).rejects.toThrow('Transaction not validated in time');
    });

    it('rethrows errors that are not txnNotFound', async () => {
      const client = makeClient({
        request: jest.fn().mockRejectedValue(new Error('node unavailable'))
      });
      installXrpl(client);
      const { result } = renderHook(() => useXRPL(), { wrapper });

      await expect(
        result.current.waitForValidation(client, 'H'.repeat(64), {
          maxAttempts: 2,
          delayMs: 1
        })
      ).rejects.toThrow('node unavailable');
    });
  });
});
