/**
 * Production error-handler hardening tests (PRD 5.1.5)
 *  - JWT/CastError mapping works (non-enumerable Error properties preserved)
 *  - No stack or raw PG error text leaks in production responses
 */

const { errorHandler } = require('../errorHandler');

describe('Error handler production hardening', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';

    mockReq = {
      method: 'GET',
      url: '/api/test',
      ip: '127.0.0.1',
      headers: {}
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('maps JsonWebTokenError to a 401 operational error', () => {
    const err = new Error('jwt malformed');
    err.name = 'JsonWebTokenError';
    err.statusCode = 401;

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    const response = mockRes.json.mock.calls[0][0];
    expect(response.success).toBe(false);
    expect(response.error).toBe('Invalid token. Please log in again!');
    expect(response.stack).toBeUndefined();
  });

  it('maps TokenExpiredError to a 401 operational error', () => {
    const err = new Error('jwt expired');
    err.name = 'TokenExpiredError';
    err.statusCode = 401;

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    const response = mockRes.json.mock.calls[0][0];
    expect(response.error).toBe('Your token has expired! Please log in again.');
    expect(response.stack).toBeUndefined();
  });

  it('maps CastError to a 400 operational error', () => {
    const err = new Error('Cast to ObjectId failed');
    err.name = 'CastError';
    err.path = '_id';
    err.value = 'not-an-id';
    err.statusCode = 400;

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    const response = mockRes.json.mock.calls[0][0];
    expect(response.error).toContain('Invalid _id');
    expect(response.stack).toBeUndefined();
  });

  it('does not leak raw PostgreSQL error messages in production', () => {
    const err = new Error('relation "secret_table" does not exist');
    err.code = '23000'; // PG integrity-constraint class, not handled specifically
    err.statusCode = 500;

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    const response = mockRes.json.mock.calls[0][0];
    expect(response.error).toBe('Database error occurred');
    expect(response.error).not.toContain('secret_table');
    expect(response.stack).toBeUndefined();
  });

  it('does not send stack traces for unknown programming errors in production', () => {
    const err = new Error('Unexpected crash');
    err.statusCode = 500;

    errorHandler(err, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    const response = mockRes.json.mock.calls[0][0];
    expect(response.error).toBe('Something went wrong!');
    expect(response.stack).toBeUndefined();
  });
});
