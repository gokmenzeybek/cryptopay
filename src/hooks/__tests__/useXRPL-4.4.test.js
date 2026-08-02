/**
 * @jest-environment jsdom
 *
 * useXRPL correctness fixes (PRD 4.4.1–4.4.3)
 *  - 4.4.1: createWallet works on a fresh page (uses the client returned by
 *           connectToXRPL, not stale state)
 *  - 4.4.2: waitForValidation tolerates txnNotFound while polling
 *  - 4.4.3: actNotFound recipients are unfunded-but-valid (base reserve rule)
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useXRPL, XRPLProvider } from '../useXRPL';

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: jest.fn().mockResolvedValue({ success: true })
});

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
    request: jest.fn().mockResolvedValue({ result: { info: { validated_ledger: {} } } }),
    ...overrides
  };
}

function installXrpl(client) {
  global.window.xrpl = {
    Client: jest.fn().mockImplementation(() => client),
    Wallet: { generate: jest.fn().mockReturnValue(mockWallet), fromSeed: jest.fn().mockReturnValue(mockWallet) },
    xrpToDrops: jest.fn().mockReturnValue('1000000'),
    dropsToXrp: jest.fn().mockReturnValue('10'),
    convertStringToHex: jest.fn().mockReturnValue('48656c6c6f')
  };
}

describe('useXRPL correctness (PRD 4.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.prompt = jest.fn().mockReturnValue(''); // skip encrypted save
  });

  it('4.4.1: createWallet on a fresh page (no prior connection) succeeds', async () => {
    const client = makeClient();
    installXrpl(client);
    const { result } = renderHook(() => useXRPL(), { wrapper });

    let wallet;
    await act(async () => {
      wallet = await result.current.createWallet();
    });

    expect(wallet).toBe(mockWallet);
    expect(client.connect).toHaveBeenCalled();
    expect(client.fundWallet).toHaveBeenCalledWith(mockWallet);
    expect(result.current.wallet).toBe(mockWallet);
  });

  it('4.4.2: waitForValidation keeps polling through txnNotFound and resolves when validated', async () => {
    let txCalls = 0;
    const client = makeClient({
      request: jest.fn().mockImplementation(async ({ command }) => {
        if (command === 'account_info') return { result: {} };
        if (command === 'server_info') return { result: { info: { validated_ledger: {} } } };
        if (command === 'tx') {
          txCalls++;
          if (txCalls === 1) {
            const err = new Error('txnNotFound');
            err.data = { error: 'txnNotFound' };
            throw err;
          }
          return { result: { validated: true, meta: { TransactionResult: 'tesSUCCESS' } } };
        }
        return { result: {} };
      })
    });
    installXrpl(client);
    const { result } = renderHook(() => useXRPL(), { wrapper });

    await act(async () => { await result.current.createWallet(); });

    let payment;
    await act(async () => {
      payment = await result.current.sendPayment('rfmZ3oN853yJKEVH1Y9nwxo6DYqdDw7Mqv', 20, 'memo');
    });

    expect(payment.success).toBe(true);
    expect(txCalls).toBe(2); // first threw txnNotFound, second returned validated
  }, 15000);

  it('4.4.3: unfunded recipient (actNotFound) is allowed when amount >= base reserve', async () => {
    const client = makeClient({
      request: jest.fn().mockImplementation(async ({ command }) => {
        if (command === 'account_info') {
          const err = new Error('actNotFound');
          err.data = { error: 'actNotFound' };
          throw err;
        }
        if (command === 'server_info') {
          return { result: { info: { validated_ledger: { base_reserve_xrp: 10000000 } } } };
        }
        if (command === 'tx') {
          return { result: { validated: true, meta: { TransactionResult: 'tesSUCCESS' } } };
        }
        return { result: {} };
      })
    });
    installXrpl(client); // dropsToXrp('10000000') → '10'
    const { result } = renderHook(() => useXRPL(), { wrapper });

    await act(async () => { await result.current.createWallet(); });

    let payment;
    await act(async () => {
      payment = await result.current.sendPayment('rfmZ3oN853yJKEVH1Y9nwxo6DYqdDw7Mqv', 20);
    });
    expect(payment.success).toBe(true);
  }, 15000);

  it('4.4.3: unfunded recipient rejected when amount < base reserve', async () => {
    const client = makeClient({
      request: jest.fn().mockImplementation(async ({ command }) => {
        if (command === 'account_info') {
          const err = new Error('actNotFound');
          err.data = { error: 'actNotFound' };
          throw err;
        }
        if (command === 'server_info') {
          return { result: { info: { validated_ledger: { base_reserve_xrp: 10000000 } } } };
        }
        return { result: {} };
      })
    });
    installXrpl(client);
    const { result } = renderHook(() => useXRPL(), { wrapper });

    await act(async () => { await result.current.createWallet(); });

    await expect(act(async () => {
      await result.current.sendPayment('rfmZ3oN853yJKEVH1Y9nwxo6DYqdDw7Mqv', 5);
    })).rejects.toThrow(/base reserve/);
  });

  it('4.4.4: insufficient balance is rejected before signing', async () => {
    mockWallet.sign.mockClear();
    const client = makeClient({
      getXrpBalance: jest.fn().mockResolvedValue('5')
    });
    installXrpl(client);
    const { result } = renderHook(() => useXRPL(), { wrapper });

    await act(async () => { await result.current.createWallet(); });
    mockWallet.sign.mockClear();

    await expect(act(async () => {
      await result.current.sendPayment('rfmZ3oN853yJKEVH1Y9nwxo6DYqdDw7Mqv', 20);
    })).rejects.toThrow(/Insufficient balance/);
    expect(mockWallet.sign).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('4.4.3: malformed recipient address is rejected', async () => {    const client = makeClient({
      request: jest.fn().mockImplementation(async ({ command }) => {
        if (command === 'account_info') {
          const err = new Error('actMalformed');
          err.data = { error: 'actMalformed' };
          throw err;
        }
        return { result: { info: { validated_ledger: {} } } };
      })
    });
    installXrpl(client);
    const { result } = renderHook(() => useXRPL(), { wrapper });

    await act(async () => { await result.current.createWallet(); });

    await expect(act(async () => {
      await result.current.sendPayment('not-an-address', 20);
    })).rejects.toThrow(/Invalid recipient address/);
  });
});
