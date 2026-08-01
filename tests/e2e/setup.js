const http = require('http');
const { pool } = require('../../database/connection');
const { initWebSocketServer } = require('../../services/websocketService');

// 1. Configure process.env variables
process.env.PORT = '5002';
process.env.NODE_ENV = 'test';

// Generous rate limits for the 60-case suite (limits are covered by domain tests instead)
process.env.RATE_LIMIT_MAX_REQUESTS = '100000';
process.env.RATE_LIMIT_AUTH = '100000';
process.env.RATE_LIMIT_READ = '100000';
process.env.RATE_LIMIT_PAYMENT_INTENT = '100000';
process.env.RATE_LIMIT_CONVERSION = '100000';
process.env.RATE_LIMIT_EXCHANGE_RATES = '100000';

// The webhook endpoint refuses to run unconfigured (503 without a secret);
// the suite signs payloads with this literal (see e2e.test.js createHmac).
process.env.PAPARA_WEBHOOK_SECRET = 'papara_webhook_secret';
// Deterministic JWT secret for auth challenge/verify flows.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e_jwt_secret';
// Moderator endpoints fail closed (503) without a key; give the suite one.
process.env.MODERATOR_API_KEY = 'e2e_moderator_key';

// 2. Capture HTTP server instance to be able to close it and mount the real WebSocket server
let testServer;
let wsServerInstance;

const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function(...args) {
  testServer = this;
  
  // Initialize the actual production WebSocket server using the captured server
  wsServerInstance = initWebSocketServer(this);
  
  // Restore immediately on first call: app.listen is invoked asynchronously
  // (after the DB health check), so restoring right after require() would
  // happen before the server ever starts listening.
  http.Server.prototype.listen = originalListen;
  
  return originalListen.apply(this, args);
};

// Start the actual server by requiring it
require('../../server.production');

// Helper to clean up database tables
async function cleanDatabase() {
  const tables = ['p2p_order_matches', 'p2p_orders', 'transactions', 'wallets', 'payment_requests', 'auth_challenges'];
  for (const table of tables) {
    try {
      await pool.query(`DELETE FROM ${table}`);
    } catch (err) {
      console.error(`Error deleting from table ${table}:`, err.message);
    }
  }
}

// Hooks
beforeAll(async () => {
  // Verify database connection is healthy
  const client = await pool.connect();
  client.release();
  
  // Clean up database tables before all tests start
  await cleanDatabase();
});

beforeEach(async () => {
  // Clean up database tables before each test
  await cleanDatabase();
});

afterEach(async () => {
  // Clean up database after each test to avoid database pollution
  await cleanDatabase();
});

afterAll(async () => {
  // 1. Clean up database tables after all tests
  await cleanDatabase();

  // 2. Close the WebSocket server
  if (wsServerInstance && wsServerInstance.wss) {
    wsServerInstance.wss.close();
  }

  // 3. Close the HTTP server
  if (testServer) {
    await new Promise((resolve) => testServer.close(resolve));
  }

  // 4. End database connection pools
  if (pool) {
    await pool.end();
  }
});
