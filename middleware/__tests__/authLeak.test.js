/**
 * Auth response leak test (PRD 5.1.5)
 * Verifies that 401 responses do not include raw error details.
 */

const authMiddleware = require('../auth');
const { pool } = require('../../database/connection');

jest.mock('../../database/connection', () => ({
  pool: {
    query: jest.fn()
  }
}));

describe('Auth middleware leak prevention', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
  });

  it('does not include raw error details in the 401 response', async () => {
    req.headers.authorization = 'Bearer not-a-valid-jwt';

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    const response = res.json.mock.calls[0][0];
    expect(response.success).toBe(false);
    expect(response.error).toBe('Unauthorized');
    expect(response.message).toBe('Invalid or expired token');
    expect(response.details).toBeUndefined();
    expect(response.stack).toBeUndefined();
  });
});
