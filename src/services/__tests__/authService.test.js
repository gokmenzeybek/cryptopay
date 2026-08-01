/**
 * @jest-environment jsdom
 *
 * AuthService tests (PRD 4.1.1)
 *  - login: challenge → sign `CryptoPay Challenge: <nonce>` (hex) → verify → stores JWT
 *  - authFetch attaches the Bearer token
 *  - 401 clears the token and fires the session-expired handler
 */

import authService, { AuthService } from '../authService';

const WALLET = {
  address: 'rJv1Fb8XG2V9twNJa2sJ3uKaZS6xQxeuns',
  publicKey: 'ED' + 'A'.repeat(64),
  privateKey: 'ED' + 'B'.repeat(64)
};

const NONCE = 'c'.repeat(64);
const EXPECTED_MESSAGE = `CryptoPay Challenge: ${NONCE}`;
const EXPECTED_HEX = unescape(encodeURIComponent(EXPECTED_MESSAGE))
  .split('')
  .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
  .join('')
  .toUpperCase();

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  });
}

describe('AuthService', () => {
  let service;
  let signMock;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    service = new AuthService();
    signMock = jest.fn().mockReturnValue('SIG' + 'D'.repeat(61));
    window.xrpl = { sign: signMock };
  });

  afterEach(() => {
    delete window.xrpl;
  });

  test('login performs challenge → sign → verify and stores the JWT', async () => {
    global.fetch = jest.fn()
      .mockReturnValueOnce(jsonResponse({ success: true, nonce: NONCE }))
      .mockReturnValueOnce(jsonResponse({ success: true, token: 'jwt_token_123' }));

    const token = await service.login(WALLET);

    expect(token).toBe('jwt_token_123');
    expect(service.getToken()).toBe('jwt_token_123');
    expect(window.localStorage.getItem('cryptopay_jwt')).toBe('jwt_token_123');

    // Challenge request
    const [challengeUrl, challengeOpts] = global.fetch.mock.calls[0];
    expect(challengeUrl).toMatch(/\/api\/auth\/challenge$/);
    expect(JSON.parse(challengeOpts.body)).toEqual({ address: WALLET.address });

    // Message signed exactly as the server hex-encodes it
    expect(signMock).toHaveBeenCalledWith(EXPECTED_HEX, WALLET.privateKey);

    // Verify request carries address, publicKey and signature
    const [verifyUrl, verifyOpts] = global.fetch.mock.calls[1];
    expect(verifyUrl).toMatch(/\/api\/auth\/verify$/);
    expect(JSON.parse(verifyOpts.body)).toEqual({
      address: WALLET.address,
      publicKey: WALLET.publicKey,
      signature: 'SIG' + 'D'.repeat(61)
    });
  });

  test('login rejects when the challenge fails', async () => {
    global.fetch = jest.fn()
      .mockReturnValueOnce(jsonResponse({ success: false, message: 'boom' }, 500));
    await expect(service.login(WALLET)).rejects.toThrow('boom');
  });

  test('authFetch attaches the Bearer token', async () => {
    service.token = 'jwt_token_123';
    global.fetch = jest.fn().mockReturnValue(jsonResponse({ success: true }));

    await service.authFetch('http://localhost:5001/api/p2p/create-order', { method: 'POST', body: '{}' });

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer jwt_token_123');
  });

  test('authFetch on 401 clears the token and fires the session-expired handler', async () => {
    service.token = 'expired_jwt';
    window.localStorage.setItem('cryptopay_jwt', 'expired_jwt');
    const onSessionExpired = jest.fn();
    service.onSessionExpired = onSessionExpired;
    global.fetch = jest.fn().mockReturnValue(jsonResponse({ success: false, error: 'Unauthorized' }, 401));

    const res = await service.authFetch('http://localhost:5001/api/p2p/my-orders');

    expect(res.status).toBe(401);
    expect(service.getToken()).toBeNull();
    expect(window.localStorage.getItem('cryptopay_jwt')).toBeNull();
    expect(onSessionExpired).toHaveBeenCalled();
  });

  test('logout clears the token', () => {
    service.token = 'jwt_token_123';
    window.localStorage.setItem('cryptopay_jwt', 'jwt_token_123');
    service.logout();
    expect(service.getToken()).toBeNull();
    expect(window.localStorage.getItem('cryptopay_jwt')).toBeNull();
  });
});
