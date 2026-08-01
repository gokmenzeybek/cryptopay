/**
 * Auth Service (PRD 4.1.1)
 * JWT login via XRPL keypair challenge/verify:
 *   1. POST /api/auth/challenge { address }        → { nonce }
 *   2. Sign `CryptoPay Challenge: <nonce>` (hex-encoded, as the server expects)
 *      with the wallet's keypair
 *   3. POST /api/auth/verify { address, publicKey, signature } → { token }
 *
 * Provides getToken(), logout(), and an authFetch() wrapper that attaches the
 * Bearer token and handles 401 by clearing the session and triggering re-login
 * when a session provider is registered.
 */

// Bundled fallback: the xrpl.js CDN bundle (window.xrpl) does not expose a
// raw message-signing function (xrpl@3 exports no `sign`/`keypairs`), so we
// use ripple-keypairs directly. It is already a project dependency (used by
// the backend) and is fully isomorphic (no Node builtins). It is require()d
// lazily inside signMessageHex so environments without TextEncoder (jsdom)
// only load it when the fallback is actually exercised.
const TOKEN_STORAGE_KEY = 'cryptopay_jwt';

/**
 * UTF-8 → uppercase hex (works in browsers and jsdom without TextEncoder)
 */
function utf8ToHex(str) {
  return unescape(encodeURIComponent(str))
    .split('')
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * API base URL resolution (must match useXRPL):
 * 1. REACT_APP_API_URL (build-time, Vercel/Render)
 * 2. window.location.origin (same-origin when Express serves the SPA)
 * 3. localhost:5001 (local dev / tests without a window origin)
 */
function apiBase() {
  if (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin;
  }
  return 'http://localhost:5001';
}

/**
 * Sign a hex-encoded message with the wallet keypair using whichever
 * keypairs implementation the loaded xrpl.js bundle exposes.
 */
function signMessageHex(messageHex, privateKey) {
  const lib = typeof window !== 'undefined' ? window.xrpl : null;
  if (lib && typeof lib.sign === 'function') {
    return lib.sign(messageHex, privateKey);
  }
  if (lib && lib.keypairs && typeof lib.keypairs.sign === 'function') {
    return lib.keypairs.sign(messageHex, privateKey);
  }
  // window.xrpl has no raw signer (xrpl@3 CDN bundle) — use the bundled
  // ripple-keypairs implementation instead (lazy require; see note above).
  const rippleKeypairs = require('ripple-keypairs');
  return rippleKeypairs.sign(messageHex, privateKey);
}

class AuthService {
  constructor() {
    this.token = null;
    this.onSessionExpired = null; // optional callback set by the app (re-login trigger)
    this.baseUrl = null;          // runtime override set by XRPLProvider (PRD 4.1.3)
  }

  /**
   * Override the API base URL at runtime (e.g. from XRPLProvider).
   * When unset, apiBase() falls back to build-time env / window.location.
   */
  setBaseUrl(url) {
    this.baseUrl = url ? url.replace(/\/$/, '') : null;
  }

  /**
   * Log in with an xrpl.js Wallet instance. Returns the JWT.
   */
  async login(wallet) {
    if (!wallet || !wallet.address || !wallet.publicKey || !wallet.privateKey) {
      throw new Error('A wallet with address, publicKey and privateKey is required to log in');
    }

    const base = this.baseUrl || apiBase();

    const challengeRes = await fetch(`${base}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: wallet.address })
    });
    const challengeData = await challengeRes.json();
    if (!challengeRes.ok || !challengeData.success) {
      throw new Error(challengeData.message || 'Failed to obtain auth challenge');
    }

    const message = `CryptoPay Challenge: ${challengeData.nonce}`;
    const messageHex = utf8ToHex(message);
    const signature = signMessageHex(messageHex, wallet.privateKey);

    const verifyRes = await fetch(`${base}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: wallet.address,
        publicKey: wallet.publicKey,
        signature
      })
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || !verifyData.success || !verifyData.token) {
      throw new Error(verifyData.message || 'Auth verification failed');
    }

    this.token = verifyData.token;
    try {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, this.token);
    } catch (_) { /* storage unavailable — keep in-memory only */ }
    return this.token;
  }

  /**
   * Current JWT: in-memory first, localStorage fallback.
   */
  getToken() {
    if (this.token) return this.token;
    try {
      this.token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch (_) { /* ignore */ }
    return this.token;
  }

  /**
   * Set the JWT directly (e.g. the short-lived guest token issued by
   * POST /api/burner/wallets, which skips the challenge/verify round-trip).
   */
  setToken(token) {
    this.token = token || null;
    try {
      if (token) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch (_) { /* storage unavailable — keep in-memory only */ }
  }

  /**
   * Clear the session.
   */
  logout() {
    this.token = null;
    try {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch (_) { /* ignore */ }
  }

  /**
   * fetch() wrapper that attaches the Bearer token. On 401 the session is
   * cleared and the registered session-expired handler is invoked (so the
   * app can trigger re-login or surface a session-expired state).
   */
  async authFetch(url, options = {}) {
    const token = this.getToken();
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });

    if (response.status === 401) {
      this.logout();
      if (typeof this.onSessionExpired === 'function') {
        this.onSessionExpired();
      }
    }

    return response;
  }
}

const authService = new AuthService();

export default authService;
export { AuthService, signMessageHex };
