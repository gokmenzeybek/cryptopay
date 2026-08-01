/**
 * Error Handling Middleware
 * Comprehensive error handling for production deployment
 */

const logger = require('../utils/logger');

/**
 * Custom error classes
 */
class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = []) {
    super(message, 400);
    this.details = details;
  }
}

class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500);
    this.originalError = originalError;
  }
}

class XRPLError extends AppError {
  constructor(message, originalError = null) {
    super(message, 502);
    this.originalError = originalError;
  }
}

class RateLimitError extends AppError {
  constructor(message, retryAfter = null) {
    super(message, 429);
    this.retryAfter = retryAfter;
  }
}

/**
 * Handle different types of errors
 */
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new ValidationError(message, errors);
};

const handleJWTError = () =>
  new AppError('Invalid token. Please log in again!', 401);

const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401);

const handlePostgresError = (err) => {
  let message = 'Database error occurred';
  let statusCode = 500;

  switch (err.code) {
    case '23505': // Unique violation
      message = 'Duplicate entry. This record already exists.';
      statusCode = 409;
      break;
    case '23503': // Foreign key violation
      message = 'Referenced record does not exist.';
      statusCode = 400;
      break;
    case '23502': // Not null violation
      message = 'Required field is missing.';
      statusCode = 400;
      break;
    case '42P01': // Undefined table
      message = 'Database table does not exist.';
      statusCode = 500;
      break;
    case 'ECONNREFUSED':
      message = 'Database connection refused.';
      statusCode = 503;
      break;
    default:
      // Keep the generic message in production; log the original for ops.
      message = 'Database error occurred';
  }

  return new DatabaseError(message, err);
};

/**
 * Send error response in development
 */
const sendErrorDev = (err, req, res) => {
  // Log error
  logger.error('Error in development', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  return res.status(err.statusCode).json({
    success: false,
    error: err.message,
    status: err.status,
    statusCode: err.statusCode,
    stack: err.stack,
    details: err.details || null
  });
};

/**
 * Send error response in production
 */
const sendErrorProd = (err, req, res) => {
  // Log error
  logger.error('Error in production', {
    error: err.message,
    statusCode: err.statusCode,
    url: req.url,
    method: req.method,
    ip: req.ip,
    isOperational: err.isOperational
  });

  // Operational, trusted error: send message to client
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      status: err.status,
      statusCode: err.statusCode,
      details: err.details || null,
      retryAfter: err.retryAfter || null
    });
  }

  // Programming or other unknown error: don't leak error details
  return res.status(500).json({
    success: false,
    error: 'Something went wrong!',
    status: 'error',
    statusCode: 500
  });
};

/**
 * Main error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res);
  } else {
    // Use the original error directly. A shallow copy `{ ...err }` drops
    // non-enumerable Error properties (name, code, stack), which breaks the
    // CastError / JsonWebTokenError / TokenExpiredError mapping below.
    let error = err;

    // Handle specific error types
    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
    if (error.code && error.code.startsWith('23')) error = handlePostgresError(error);

    sendErrorProd(error, req, res);
  }
};

/**
 * Catch async errors
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

/**
 * Handle unhandled promise rejections
 */
const handleUnhandledRejection = () => {
  process.on('unhandledRejection', (err, promise) => {
    logger.error('Unhandled Promise Rejection', {
      error: err.message,
      stack: err.stack,
      promise: promise
    });
    
    // Close server gracefully
    process.exit(1);
  });
};

/**
 * Handle uncaught exceptions
 */
const handleUncaughtException = () => {
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', {
      error: err.message,
      stack: err.stack
    });
    
    // Close server gracefully
    process.exit(1);
  });
};

/**
 * Handle SIGTERM
 *
 * NOTE: This handler intentionally does NOT call process.exit(). The production
 * server registers its own graceful shutdown in startServer() (server.close +
 * pool.end). An early exit here would prevent that real teardown from running.
 */
const handleSIGTERM = () => {
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Passing control to the graceful shutdown handler...');
  });
};

/**
 * Handle SIGINT
 */
const handleSIGINT = () => {
  process.on('SIGINT', () => {
    logger.info('SIGINT received. Passing control to the graceful shutdown handler...');
  });
};

module.exports = {
  AppError,
  ValidationError,
  DatabaseError,
  XRPLError,
  RateLimitError,
  errorHandler,
  catchAsync,
  handleUnhandledRejection,
  handleUncaughtException,
  handleSIGTERM,
  handleSIGINT
};