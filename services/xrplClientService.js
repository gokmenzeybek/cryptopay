/**
 * Shared XRPL Client Service
 * Provides a lazily-connected singleton xrpl.Client that is reused across
 * requests instead of opening a new WebSocket connection (and paying the
 * handshake) per operation. This is a large latency win for the escrow,
 * confirm, and on-chain verification endpoints on free-tier hosts.
 *
 * The client is not thread-safe in the sense of multiple submits racing on a
 * single sequence, but concurrent read-style `request()` calls are fine (the
 * xrpl library queues them over the one socket). Mutating operations that
 * require a fresh view (e.g. account_info) are naturally serialized by the
 * ledger.
 *
 * If the connection drops, the singleton is discarded so the next caller
 * reconnects transparently.
 */

const xrpl = require('xrpl');
const logger = require('../utils/logger');

const XRPL_URL = process.env.XRPL_TESTNET_URL || 'wss://s.altnet.rippletest.net:51233';

// Singleton state: the connected client, plus the in-flight connect promise so
// concurrent callers share a single handshake instead of racing to connect.
let sharedClient = null;
let connectingPromise = null;

/**
 * Reset shared state (called on disconnect/error and from tests).
 */
function resetClient() {
  sharedClient = null;
  connectingPromise = null;
}

/**
 * Get a connected xrpl.Client, reusing the existing connection when available.
 * @returns {Promise<import('xrpl').Client>}
 */
async function getClient() {
  if (sharedClient && sharedClient.isConnected()) {
    return sharedClient;
  }

  // If a connect attempt is already in flight, share it.
  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    const client = new xrpl.Client(XRPL_URL);

    // If the socket drops (idle timeout, network blip, server restart), drop
    // the singleton so the next caller establishes a fresh connection.
    client.on('disconnected', () => {
      logger.warn('XRPL client disconnected; clearing shared client');
      resetClient();
    });
    client.on('error', (err) => {
      logger.error('XRPL client error', { error: err && err.message });
      resetClient();
    });

    await client.connect();
    sharedClient = client;
    connectingPromise = null;
    return client;
  })();

  try {
    return await connectingPromise;
  } catch (err) {
    connectingPromise = null;
    throw err;
  }
}

/**
 * Eagerly warm the shared connection (optional — call from startServer so the
 * first user request never pays the handshake).
 */
async function warmUp() {
  try {
    await getClient();
  } catch (err) {
    logger.warn('XRPL client warm-up failed (will retry on demand)', { error: err.message });
  }
}

/**
 * Tear down the shared client (graceful shutdown / tests). Safe to call when
 * no client exists.
 */
async function disconnectClient() {
  const client = sharedClient;
  resetClient();
  if (client && typeof client.disconnect === 'function') {
    try {
      await client.disconnect();
    } catch (err) { /* already closed */ }
  }
}

module.exports = {
  getClient,
  disconnectClient,
  warmUp,
  resetClient
};
