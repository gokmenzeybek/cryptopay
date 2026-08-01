const jwt = require('jsonwebtoken');
const { pool } = require('../database/connection');
const logger = require('../utils/logger');

// No fallback: JWT_SECRET is mandatory. startServer() refuses to boot in
// production without it (see validateEnvironment); in tests it is provided
// by tests/setup.js.
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * JWT Authentication Middleware
 * Verifies Authorization Bearer token, checks database if wallet is active,
 * and sets req.user = { address, id }.
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Access token is missing or invalid'
      });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or expired token'
      });
    }

    if (!decoded || !decoded.address) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Token payload is missing wallet address'
      });
    }

    // Query database to ensure wallet exists and is active
    const result = await pool.query(
      'SELECT id, address, is_active, role FROM wallets WHERE address = $1',
      [decoded.address]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Wallet not registered'
      });
    }

    const wallet = result.rows[0];
    if (!wallet.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Wallet is inactive'
      });
    }

    // Attach user info to request
    req.user = {
      address: wallet.address,
      id: wallet.id,
      role: wallet.role || 'buyer'
    };

    next();
  } catch (err) {
    logger.error('Error in auth middleware:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to authenticate request'
    });
  }
};

module.exports = authMiddleware;
