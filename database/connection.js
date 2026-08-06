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
    max: parseInt(process.env.DB_POOL_MAX, 10) || 50,
    min: parseInt(process.env.DB_POOL_MIN, 10) || 5,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 10000,
    // Per-statement query timeout (ms) — cancelled server-side by Postgres.
    statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10) || 30000
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

/**
 * Snapshot of the current pg.Pool state for /api/health and metrics consumers.
 * `healthy` becomes false when the waiting queue exceeds 80% of `max` — a
 * leading indicator of pool saturation before requests actually time out.
 */
const getPoolStatus = async () => {
  const max = pool.options.max;
  const waiting = pool.waitingCount;
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting,
    max,
    healthy: waiting < (max * 0.8)
  };
};

/**
 * Execute a read query on the read replica (or primary if no replica configured).
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function readQuery(text, params) {
  const { getReadPool } = require('./readReplica');
  const pool = getReadPool();
  return pool.query(text, params);
}

// Handle process termination
process.on('SIGINT', closePool);
process.on('SIGTERM', closePool);

module.exports = {
  pool,
  testConnection,
  healthCheck,
  getPoolStatus,
  getReadPool: require('./readReplica').getReadPool,
  hasReadReplica: require('./readReplica').hasReadReplica,
  getReadReplicaMetrics: require('./readReplica').getReadReplicaMetrics,
  closeReadPool: require('./readReplica').closeReadPool,
  closePool,
  readQuery
};