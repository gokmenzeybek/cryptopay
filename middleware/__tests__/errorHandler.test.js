/**
 * Unit Tests for Error Handler Middleware (current middleware/errorHandler.js API)
 *
 * Rewritten in Phase 7 (PRD 7.1.1): the previous suite imported the module as a
 * bare function and asserted a legacy response shape ({message, timestamp, path})
 * that no longer exists. These tests cover the actual exports and response
 * contract: { success, error, status, statusCode, details, retryAfter } in
 * production mode and the stack-bearing shape in development mode.
 */

const {
  AppError,
  ValidationError,
  DatabaseError,
  XRPLError,
  RateLimitError,
  errorHandler,
  catchAsync
} = require('../errorHandler');

describe('Error Handler Middleware', () => {
  let mockReq, mockRes, mockNext;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockReq = {
      method: 'GET',
      url: '/api/test',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Test Agent' }
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {}
    };
    mockNext = jest.fn();
    process.env.NODE_ENV = 'test'; // production-style responses
  });

  afterEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = originalEnv;
  });

  describe('error classes', () => {
    it('AppError sets statusCode, isOperational and 4xx/5xx status', () => {
      const e4 = new AppError('bad input', 400);
      expect(e4.statusCode).toBe(400);
      expect(e4.status).toBe('fail');
      expect(e4.isOperational).toBe(true);

      const e5 = new AppError('boom', 500);
      expect(e5.status).toBe('error');
    });

    it('ValidationError is a 400 with details', () => {
      const e = new ValidationError('invalid', ['a required']);
      expect(e.statusCode).toBe(400);
      expect(e.details).toEqual(['a required']);
    });

    it('DatabaseError / XRPLError / RateLimitError carry their status codes and extras', () => {
      expect(new DatabaseError('db').statusCode).toBe(500);
      expect(new XRPLError('xrpl').statusCode).toBe(502);
      const rl = new RateLimitError('slow down', 60);
      expect(rl.statusCode).toBe(429);
      expect(rl.retryAfter).toBe(60);
    });
  });

  describe('errorHandler (production-style responses)', () => {
    it('handles a generic operational error with its status code', () => {
      const err = new AppError('Test error', 500);
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Test error',
        status: 'error',
        statusCode: 500,
        details: null,
        retryAfter: null
      });
    });

    it('defaults errors without a statusCode to 500', () => {
      const err = new Error('plain');
      err.isOperational = true;
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('masks non-operational (programming) errors', () => {
      const err = new Error('sensitive internals');
      err.isOperational = false;
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Something went wrong!',
        status: 'error',
        statusCode: 500
      });
    });

    it('maps CastError to a 400 AppError', () => {
      const err = new Error('cast failed');
      err.name = 'CastError';
      err.path = 'id';
      err.value = 'xyz';
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json.mock.calls[0][0].error).toBe('Invalid id: xyz');
    });

    it('maps duplicate-key (11000) errors to 400', () => {
      const err = new Error('dup');
      err.code = 11000;
      err.errmsg = 'index: email_1 dup key: { email: "a@b.c" }';
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json.mock.calls[0][0].error).toContain('Duplicate field value');
    });

    it('maps Mongoose-style ValidationError to a 400 ValidationError', () => {
      const err = new Error('validation');
      err.name = 'ValidationError';
      err.errors = { a: { message: 'a required' }, b: { message: 'b invalid' } };
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json.mock.calls[0][0].error).toContain('a required');
    });

    it('maps JsonWebTokenError to 401 without leaking token details', () => {
      const err = new Error('invalid signature');
      err.name = 'JsonWebTokenError';
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json.mock.calls[0][0].error).toBe(
        'Invalid token. Please log in again!'
      );
    });

    it('maps TokenExpiredError to 401', () => {
      const err = new Error('jwt expired');
      err.name = 'TokenExpiredError';
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json.mock.calls[0][0].error).toBe(
        'Your token has expired! Please log in again.'
      );
    });

    it.each([
      ['23505', 'Duplicate entry. This record already exists.'],
      ['23503', 'Referenced record does not exist.'],
      ['23502', 'Required field is missing.']
    ])('maps Postgres code %s to a safe message', (code, expected) => {
      const err = new Error('raw pg detail: relation "secret_table"');
      err.code = code;
      errorHandler(err, mockReq, mockRes, mockNext);
      const body = mockRes.json.mock.calls[0][0];
      expect(body.error).toBe(expected);
      expect(body.error).not.toContain('secret_table');
    });

    it('masks non-23xx database errors as unknown errors (no raw PG text leak)', () => {
      const err = new Error('relation "p2p_orders" does not exist');
      err.code = '42601';
      errorHandler(err, mockReq, mockRes, mockNext);
      const body = mockRes.json.mock.calls[0][0];
      expect(body.error).toBe('Something went wrong!');
      expect(body.error).not.toContain('p2p_orders');
    });

    it('includes details and retryAfter for operational errors that carry them', () => {
      const err = new ValidationError('Validation failed', ['Field is required']);
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json.mock.calls[0][0].details).toEqual(['Field is required']);

      mockRes.status.mockClear();
      const rl = new RateLimitError('Too many requests', 120);
      errorHandler(rl, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json.mock.calls[1][0].retryAfter).toBe(120);
    });
  });

  describe('errorHandler (development mode)', () => {
    it('includes the stack and echoes the raw error message', () => {
      process.env.NODE_ENV = 'development';
      const err = new Error('dev details');
      err.statusCode = 418;
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(418);
      const body = mockRes.json.mock.calls[0][0];
      expect(body.error).toBe('dev details');
      expect(body.stack).toBeDefined();
    });
  });

  describe('catchAsync', () => {
    it('forwards resolved calls and catches rejections into next', async () => {
      const ok = catchAsync(async (req, res) => res.json({ ok: true }));
      ok(mockReq, mockRes, mockNext);
      await Promise.resolve();
      expect(mockRes.json).toHaveBeenCalledWith({ ok: true });

      const boom = new Error('async boom');
      const failing = catchAsync(async () => {
        throw boom;
      });
      failing(mockReq, mockRes, mockNext);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockNext).toHaveBeenCalledWith(boom);
    });
  });
});
