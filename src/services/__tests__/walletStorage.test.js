/**
 * @jest-environment jsdom
 *
 * Secure wallet storage tests (PRD 4.3.1/4.3.2)
 *  - encrypted roundtrip: save → load returns the seed
 *  - stored/exported records never contain the plaintext seed
 *  - wrong password → unlock fails
 */

const { webcrypto } = require('crypto');

// jsdom lacks WebCrypto — inject Node's implementation
Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

// jsdom also lacks TextEncoder/TextDecoder
const { TextEncoder, TextDecoder } = require('util');
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, configurable: true });

import {
  saveWalletEncrypted,
  loadWalletEncrypted,
  hasStoredWallet,
  getStoredWalletAddress,
  clearStoredWallet,
  encryptWalletForExport
} from '../walletStorage';

const WALLET = {
  address: 'rJv1Fb8XG2V9twNJa2sJ3uKaZS6xQxeuns',
  seed: 'sn3nxiW7v8KXzPzAqzzy7sz6SZQ2h',
  publicKey: 'ED' + 'A'.repeat(64)
};

describe('walletStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('save → load roundtrip returns the seed', async () => {
    await saveWalletEncrypted(WALLET, 'correct horse battery staple');
    expect(hasStoredWallet()).toBe(true);
    expect(getStoredWalletAddress()).toBe(WALLET.address);

    const { seed, address } = await loadWalletEncrypted('correct horse battery staple');
    expect(seed).toBe(WALLET.seed);
    expect(address).toBe(WALLET.address);
  });

  test('stored record never contains the plaintext seed', async () => {
    await saveWalletEncrypted(WALLET, 'pw');
    const raw = window.localStorage.getItem('cryptopay_wallet_enc');
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(WALLET.seed);
    const record = JSON.parse(raw);
    expect(record.ciphertext).toBeTruthy();
    expect(record.salt).toBeTruthy();
    expect(record.iv).toBeTruthy();
  });

  test('wrong password → unlock fails', async () => {
    await saveWalletEncrypted(WALLET, 'right');
    await expect(loadWalletEncrypted('wrong')).rejects.toThrow(/unlock failed/);
  });

  test('no stored wallet → load fails clearly', async () => {
    await expect(loadWalletEncrypted('pw')).rejects.toThrow(/No stored wallet/);
    expect(hasStoredWallet()).toBe(false);
  });

  test('clearStoredWallet removes the record', async () => {
    await saveWalletEncrypted(WALLET, 'pw');
    clearStoredWallet();
    expect(hasStoredWallet()).toBe(false);
  });

  test('encrypted export contains metadata but never the plaintext seed (PRD 4.3.2)', async () => {
    const record = await encryptWalletForExport(WALLET, 'export-pw');
    const raw = JSON.stringify(record);
    expect(raw).not.toContain(WALLET.seed);
    expect(record.format).toBe('cryptopay-wallet-encrypted');
    expect(record.address).toBe(WALLET.address);
    expect(record.kdf.name).toBe('PBKDF2');
    expect(record.cipher.name).toBe('AES-GCM');
  });

  test('save/export require a password', async () => {
    await expect(saveWalletEncrypted(WALLET, '')).rejects.toThrow(/password is required/);
    await expect(encryptWalletForExport(WALLET, '')).rejects.toThrow(/password is required/);
  });
});
