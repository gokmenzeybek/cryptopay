/**
 * Secure wallet storage (PRD 4.3.1)
 * Persists the wallet seed client-side, encrypted with WebCrypto AES-GCM
 * using a PBKDF2 key derived from a user password. The server never sees
 * the seed — only address + publicKey are synced via the API.
 *
 * Stored record (localStorage 'cryptopay_wallet_enc'):
 *   { v, address, salt, iv, ciphertext }  — all base64/hex, never plaintext.
 */

const STORAGE_KEY = 'cryptopay_wallet_enc';
const PBKDF2_ITERATIONS = 210000;

function bytesToB64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt and store the wallet seed. Throws on WebCrypto failure.
 */
export async function saveWalletEncrypted(wallet, password) {
  if (!wallet || !wallet.seed) throw new Error('Wallet with a seed is required');
  if (!password) throw new Error('A password is required to encrypt the wallet');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify({ seed: wallet.seed }))
  );

  const record = {
    v: 1,
    address: wallet.address,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(ciphertext)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  return record.address;
}

/**
 * Decrypt the stored wallet seed. Throws 'Wallet unlock failed' on a wrong
 * password (AES-GCM auth tag mismatch) and 'No stored wallet' when absent.
 */
export async function loadWalletEncrypted(password) {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error('No stored wallet');

  const record = JSON.parse(raw);
  try {
    const key = await deriveKey(password, b64ToBytes(record.salt));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(record.iv) },
      key,
      b64ToBytes(record.ciphertext)
    );
    const { seed } = JSON.parse(new TextDecoder().decode(plain));
    return { seed, address: record.address };
  } catch (err) {
    throw new Error('Wallet unlock failed — wrong password or corrupted data');
  }
}

export function hasStoredWallet() {  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    return false;
  }
}

export function getStoredWalletAddress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).address : null;
  } catch (_) {
    return null;
  }
}

export function clearStoredWallet() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) { /* ignore */ }
}

/**
 * Build the encrypted record for file export (same format as storage,
 * PRD 4.3.2) — the exported JSON never contains the plaintext seed.
 */
export async function encryptWalletForExport(wallet, password) {
  if (!wallet || !wallet.seed) throw new Error('Wallet with a seed is required');
  if (!password) throw new Error('A password is required to encrypt the export');

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify({ seed: wallet.seed }))
  );

  return {
    format: 'cryptopay-wallet-encrypted',
    v: 1,
    address: wallet.address,
    publicKey: wallet.publicKey,
    kdf: { name: 'PBKDF2', iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    cipher: { name: 'AES-GCM' },
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(ciphertext)
  };
}
