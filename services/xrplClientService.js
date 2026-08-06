/**
 * XRPL Connection Pool Service
 *
 * Provides a pool of xrpl.Client connections instead of a single singleton.
 * This allows concurrent blockchain operations (e.g., multiple escrow
 * verifications) to proceed in parallel instead of serializing through one
 * WebSocket.
 *
 * Pool size is configurable via XRPL_POOL_SIZE (default 3, max 10).
 * When a client disconnects, it's automatically replaced.
 *
 * Backwards-compatible API: getClient() still returns a connected xrpl.Client.
 */

const xrpl = require('xrpl');
const logger = require('../utils/logger');

const XRPL_URL = process.env.XRPL_TESTNET_URL || 'wss://s.altnet.rippletest.net:51233';
const POOL_SIZE = parseInt(process.env.XRPL_POOL_SIZE, 10) || 3;
const MAX_POOL_SIZE = 10;

// Pool state
const pool = [];
let poolSize = 0;

/**
 * Create a new xrpl.Client and connect it.
 * @returns {Promise<xrpl.Client>}
 */
async function createClient() {
  const client = new xrpl.Client(XRPL_URL);

  client.on('disconnected', () => {
    logger.warn('XRPL pool client disconnected');
    removeFromPool(client);
  });

  client.on('error', (err) => {
    logger.error('XRPL pool client error', { error: err.message });
    removeFromPool(client);
  });

  await client.connect();
  poolSize++;
  logger.debug('XRPL pool client connected', { poolSize });
  return client;
}

/**
 * Remove a client from the pool and create a replacement.
 * @param {xrpl.Client} client
 */
function removeFromPool(client) {
  const idx = pool.indexOf(client);
  if (idx !== -1) {
    pool.splice(idx, 1);
    poolSize--;
  }
  if (poolSize < POOL_SIZE) {
    createClient().then(c => pool.push(c)).catch(err => {
      logger.error('Failed to replace pool client', { error: err.message });
    });
  }
}

/**
 * Get a connected xrpl.Client from the pool (round-robin).
 * Creates a new client if pool is empty and under max.
 * @returns {Promise<xrpl.Client>}
 */
async function getClient() {
  // Find a connected client
  while (pool.length > 0) {
    const client = pool.shift();
    if (client.isConnected()) {
      pool.push(client);
      return client;
    }
    removeFromPool(client);
  }

  // No clients available — create one if under max
  if (poolSize < MAX_POOL_SIZE) {
    const client = await createClient();
    pool.push(client);
    return client;
  }

  // Pool exhausted — create one anyway (don't block indefinitely)
  logger.warn('XRPL pool exhausted, creating overflow client', { poolSize, max: MAX_POOL_SIZE });
  const client = await createClient();
  pool.push(client);
  return client;
}

/**
 * Initialize the pool on startup. Creates POOL_SIZE connections.
 * @returns {Promise<void>}
 */
async function initPool() {
  if (pool.length > 0) return;

  logger.info('Initializing XRPL connection pool', { poolSize: POOL_SIZE });

  const clients = await Promise.allSettled(
    Array.from({ length: POOL_SIZE }, () => createClient())
  );

  clients.forEach((result) => {
    if (result.status === 'fulfilled') {
      pool.push(result.value);
    } else {
      logger.error('Failed to create pool client', { error: result.reason?.message });
      poolSize--;
    }
  });

  logger.info('XRPL pool initialized', { connected: pool.length });
}

/**
 * Backwards-compatible warmUp — initializes the pool.
 * @deprecated Use initPool() instead.
 */
async function warmUp() {
  try {
    await initPool();
  } catch (err) {
    logger.warn('XRPL pool warm-up failed (will retry on demand)', { error: err.message });
  }
}

/**
 * Tear down all pool clients (graceful shutdown / tests).
 * @returns {Promise<void>}
 */
async function disconnectPool() {
  const clients = [...pool];
  pool.length = 0;
  poolSize = 0;
  await Promise.all(clients.map(client => {
    try { return client.disconnect(); } catch (err) { return Promise.resolve(); }
  }));
  logger.info('XRPL pool disconnected');
}

/**
 * Backwards-compatible disconnect — tears down the pool.
 * @deprecated Use disconnectPool() instead.
 */
async function disconnectClient() {
  await disconnectPool();
}

/**
 * Reset pool state (for tests).
 */
function resetClient() {
  pool.length = 0;
  poolSize = 0;
}

/**
 * Get pool metrics.
 * @returns {Object} { poolSize, available, targetSize, maxSize }
 */
function getPoolMetrics() {
  return {
    poolSize,
    available: pool.length,
    targetSize: POOL_SIZE,
    maxSize: MAX_POOL_SIZE
  };
}

module.exports = {
  getClient,
  initPool,
  disconnectPool,
  getPoolMetrics,
  resetClient,
  // Legacy aliases
  warmUp,
  disconnectClient
};
