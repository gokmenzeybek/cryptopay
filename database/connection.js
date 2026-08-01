#!/usr/bin/env node
/**
 * PostgreSQL Database Connection Module
 * Handles database connections, pooling, and health checks
 */

const { Pool } = require('pg');
require('dotenv').config();
const logger = require('../utils/logger');

// Database configuration. Prefer DATABASE_URL (Supabase/Render/Neon) when set;
// otherwise fall back to discrete POSTGRES_* vars for local Docker.
const buildDbConfig = () => {
  const poolDefaults = {
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    min: parseInt(process.env.DB_POOL_MIN, 10) || 0,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 10000
  };

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ...poolDefaults,
      // Managed Postgres (Supabase/Render) requires TLS; allow self-signed intermediates.
      ssl: process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false }
    };
  }

  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
    database: process.env.POSTGRES_DB || 'cryptopay',
    user: process.env.POSTGRES_USER || 'cryptopay',
    password: process.env.POSTGRES_PASSWORD,
    ...poolDefaults,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
};

const dbConfig = buildDbConfig();

// Create connection pool
const pool = new Pool(dbConfig);

// Handle pool errors: log through Winston and keep the process alive. A single
// bad idle client is not fatal; the pool will recreate clients as needed.
pool.on('error', (err) => {
  logger.error('Unexpected error on idle database client', {
    error: err.message,
    stack: err.stack
  });
});

// Test database connection
const testConnection = async () => {
  try {
    const client = await pool.connect();
    logger.info('Database connected successfully');
    await client.query('SELECT NOW()');
    client.release();
    return true;
  } catch (err) {
    logger.error('Database connection failed', { error: err.message, stack: err.stack });
    return false;
  }
};

// Health check for database
const healthCheck = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT 1 as healthy');
    client.release();
    return { healthy: true, timestamp: new Date().toISOString() };
  } catch (err) {
    logger.error('Database health check failed', { error: err.message, stack: err.stack });
    return { healthy: false, error: err.message, timestamp: new Date().toISOString() };
  }
};

// Graceful shutdown
const closePool = async () => {
  try {
    await pool.end();
    logger.info('Database pool closed');
  } catch (err) {
    logger.error('Error closing database pool', { error: err.message, stack: err.stack });
  }
};

// Handle process termination
process.on('SIGINT', closePool);
process.on('SIGTERM', closePool);

module.exports = {
  pool,
  testConnection,
  healthCheck,
  closePool
};