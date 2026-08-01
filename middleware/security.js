/**
 * Security Middleware
 * Comprehensive security configuration for production deployment
 */

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');

/**
 * Security headers configuration
 */
// Extra connect-src hosts for split FE/BE deploys (comma-separated env).
const extraConnectSrc = (process.env.CSP_CONNECT_SRC || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "https://unpkg.com", "'wasm-unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:"],
      // Scanner beep (data: audio) — @yudiel/react-qr-scanner
      mediaSrc: ["'self'", "data:"],
      connectSrc: [
        "'self'",
        "wss://s.altnet.rippletest.net:51233",
        "wss://s.devnet.rippletest.net:51233",
        // XRPL testnet/devnet faucets — client.fundWallet() fetches these
        "https://faucet.altnet.rippletest.net",
        "https://faucet.devnet.rippletest.net",
        // zxing-wasm barcode reader fetched at runtime by the QR scanner
        "https://fastly.jsdelivr.net",
        ...extraConnectSrc
      ],
      objectSrc: ["'none'"],
      // Disabled explicitly (helmet's default CSP enables it): the app is
      // served over plain HTTP (localhost/LAN), and upgrade-insecure-requests
      // forces browsers to fetch subresources via HTTPS, which fails TLS and
      // breaks the frontend.
      upgradeInsecureRequests: null,
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  // Allow cross-origin browser reads when FE (Vercel) and BE (Render) are split.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
});

/**
 * CORS configuration for production
 */
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Outside production, allow all origins (local network / development use)
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    
    const allowedOriginsEnv = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN;
    const allowedOrigins = allowedOriginsEnv
      ? allowedOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
      : ['http://localhost:3000', 'http://localhost:5001'];

    // Allow any vercel.app / onrender.com subdomain in demo deploys when listed as wildcard markers
    const allowed =
      allowedOrigins.includes(origin) ||
      allowedOrigins.includes('*') ||
      (allowedOrigins.includes('*.vercel.app') && /\.vercel\.app$/.test(origin));

    if (allowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 204,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

/**
 * Rate limiting configuration
 */
const createRateLimiter = (windowMs = 15 * 60 * 1000, max = 100) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      error: 'Too many requests',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
  });
};

/**
 * Input validation middleware
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      message: 'Invalid input data',
      details: errors.array()
    });
  }
  next();
};

/**
 * XRPL Address validation
 */
const validateXRPLAddress = (field = 'address') => {
  return body(field)
    .isLength({ min: 25, max: 34 })
    .matches(/^r[a-zA-Z0-9]{24,33}$/)
    .withMessage('Invalid XRPL address format');
};

/**
 * XRPL Transaction Hash validation
 */
const validateTransactionHash = (field = 'hash') => {
  return body(field)
    .isLength({ min: 64, max: 64 })
    .matches(/^[A-Fa-f0-9]{64}$/)
    .withMessage('Invalid transaction hash format');
};

/**
 * Amount validation
 */
const validateAmount = (field = 'amount', min = 0.000001) => {
  return body(field)
    .isFloat({ min })
    .withMessage(`Amount must be a positive number greater than ${min}`);
};

/**
 * Order type validation
 */
const validateOrderType = (field = 'type') => {
  return body(field)
    .isIn(['buy', 'sell'])
    .withMessage('Order type must be either "buy" or "sell"');
};

/**
 * Payment method validation
 */
const validatePaymentMethod = (field = 'paymentMethods') => {
  return body(field)
    .custom((value) => {
      const validMethods = ['bank_transfer', 'papara', 'ininal', 'mefete', 'qr_havale'];
      const methods = Array.isArray(value) ? value : [value];
      return methods.every(method => validMethods.includes(method));
    })
    .withMessage('Invalid payment method. Must be one of: bank_transfer, papara, ininal, mefete, qr_havale');
};

/**
 * Order status validation
 */
const validateOrderStatus = (field = 'status') => {
  return body(field)
    .isIn(['OPEN', 'MATCHED', 'PAYMENT_CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED'])
    .withMessage('Invalid order status');
};

/**
 * XRPL Address validation for route parameters
 */
const validateXRPLAddressParam = (field = 'address') => {
  return param(field)
    .isLength({ min: 25, max: 34 })
    .matches(/^r[a-zA-Z0-9]{24,33}$/)
    .withMessage('Invalid XRPL address format');
};
const validateUUID = (field = 'id') => {
  return param(field)
    .isUUID()
    .withMessage('Invalid ID format');
};

/**
 * Pagination validation
 */
const validatePagination = () => {
  return [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be a non-negative integer')
  ];
};

/**
 * Sanitize input data
 */
const sanitizeInput = (req, res, next) => {
  // Remove any potential XSS attempts
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  };

  // Sanitize body
  if (req.body) {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      }
    }
  }

  // Sanitize query parameters
  if (req.query) {
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = sanitizeString(req.query[key]);
      }
    }
  }

  next();
};

/**
 * Request logging middleware
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    };
    
    if (res.statusCode >= 400) {
      console.error('HTTP Error:', logData);
    } else {
      console.log('HTTP Request:', logData);
    }
  });
  
  next();
};

module.exports = {
  securityHeaders,
  corsOptions,
  createRateLimiter,
  validateRequest,
  validateXRPLAddress,
  validateXRPLAddressParam,
  validateTransactionHash,
  validateAmount,
  validateOrderType,
  validatePaymentMethod,
  validateOrderStatus,
  validateUUID,
  validatePagination,
  sanitizeInput,
  requestLogger
};