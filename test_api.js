#!/usr/bin/env node
/**
 * CryptoPay API Test Suite
 * Tests all API endpoints to ensure they're working correctly
 */

const axios = require('axios');

const API_BASE = 'http://127.0.0.1:5001';
const TIMEOUT = 5000;

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
};

let passedTests = 0;
let failedTests = 0;

/**
 * Test helper function
 */
async function test(name, testFn) {
  try {
    await testFn();
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    passedTests++;
  } catch (error) {
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    console.log(`  ${colors.red}Error: ${error.message}${colors.reset}`);
    failedTests++;
  }
}

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.blue}🧪 CryptoPay API Test Suite${colors.reset}`);
  console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  // Test 1: Health Check
  await test('GET /api/health - Should return healthy status', async () => {
    const response = await axios.get(`${API_BASE}/api/health`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
    assert(response.data.status === 'healthy', 'Status should be healthy');
    assert(response.data.database === 'in-memory', 'Database should be in-memory');
  });

  // Test 2: API Root Documentation
  await test('GET /api - Should return API documentation', async () => {
    const response = await axios.get(`${API_BASE}/api`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.message, 'Should have a message');
    assert(response.data.endpoints, 'Should have endpoints');
    assert(response.data.endpoints.wallets === '/api/wallets', 'Should have wallets endpoint');
  });

  // Test 3: Get Wallets (Empty)
  await test('GET /api/wallets - Should return empty wallet list', async () => {
    const response = await axios.get(`${API_BASE}/api/wallets`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
    assert(Array.isArray(response.data.wallets), 'Wallets should be an array');
    assert(response.data.count === response.data.wallets.length, 'Count should match array length');
  });

  // Test 4: Add Wallet
  await test('POST /api/wallets - Should add a new wallet', async () => {
    const walletData = {
      address: 'rTestAddress123456789',
      seed: 'sTestSeed123456789',
      public_key: 'testPublicKey123',
      private_key: 'testPrivateKey123'
    };
    const response = await axios.post(`${API_BASE}/api/wallets`, walletData, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
    assert(response.data.message, 'Should have a message');
  });

  // Test 5: Get Wallets (With Data)
  await test('GET /api/wallets - Should return wallet list with added wallet', async () => {
    const response = await axios.get(`${API_BASE}/api/wallets`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
    assert(response.data.count > 0, 'Should have at least one wallet');
    assert(response.data.wallets[0].address === 'rTestAddress123456789', 'Should have the test wallet');
  });

  // Test 6: Get Transactions (Empty)
  await test('GET /api/transactions - Should return transaction list', async () => {
    const response = await axios.get(`${API_BASE}/api/transactions`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
    assert(Array.isArray(response.data.transactions), 'Transactions should be an array');
  });

  // Test 7: Add Transaction
  await test('POST /api/transactions - Should add a new transaction', async () => {
    const txData = {
      hash: 'testTxHash123456789',
      from_address: 'rTestAddress123456789',
      to_address: 'rRecipient123456789',
      amount: 10.5,
      memo: 'Test payment',
      timestamp: new Date().toISOString(),
      status: 'completed',
      block_number: 12345,
      fee: 0.00001
    };
    const response = await axios.post(`${API_BASE}/api/transactions`, txData, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
  });

  // Test 8: Get Transactions with Limit
  await test('GET /api/transactions?limit=10 - Should respect limit parameter', async () => {
    const response = await axios.get(`${API_BASE}/api/transactions?limit=10`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.transactions.length <= 10, 'Should return max 10 transactions');
  });

  // Test 9: Get Payment Requests
  await test('GET /api/payment_requests - Should return payment requests list', async () => {
    const response = await axios.get(`${API_BASE}/api/payment_requests`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
    assert(Array.isArray(response.data.payment_requests), 'Payment requests should be an array');
  });

  // Test 10: Add Payment Request
  await test('POST /api/payment_requests - Should add a new payment request', async () => {
    const reqData = {
      request_id: 'req_test_123456789',
      amount: 5.0,
      recipient: 'rTestAddress123456789',
      memo: 'Test request',
      status: 'pending',
      created_at: new Date().toISOString(),
      qr_data: 'test_qr_data'
    };
    const response = await axios.post(`${API_BASE}/api/payment_requests`, reqData, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
  });

  // Test 11: Get Payment Requests with Status Filter
  await test('GET /api/payment_requests?status=pending - Should filter by status', async () => {
    const response = await axios.get(`${API_BASE}/api/payment_requests?status=pending`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
    const allPending = response.data.payment_requests.every(req => req.status === 'pending');
    assert(allPending, 'All requests should have pending status');
  });

  // Test 12: Get Statistics
  await test('GET /api/stats - Should return statistics', async () => {
    const response = await axios.get(`${API_BASE}/api/stats`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
    assert(response.data.stats, 'Should have stats object');
    assert(typeof response.data.stats.active_wallets === 'number', 'Active wallets should be a number');
    assert(typeof response.data.stats.total_transactions === 'number', 'Total transactions should be a number');
    assert(typeof response.data.stats.total_volume_xrp === 'number', 'Total volume should be a number');
  });

  // Test 13: Export Data
  await test('GET /api/export - Should export all data', async () => {
    const response = await axios.get(`${API_BASE}/api/export`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.success === true, 'Success should be true');
    assert(response.data.data, 'Should have data object');
    assert(Array.isArray(response.data.data.wallets), 'Should have wallets array');
    assert(Array.isArray(response.data.data.transactions), 'Should have transactions array');
    assert(Array.isArray(response.data.data.payment_requests), 'Should have payment requests array');
  });

  // Test 14: Shared Dashboard HTML
  await test('GET /shared_dashboard.html - Should serve dashboard', async () => {
    const response = await axios.get(`${API_BASE}/shared_dashboard.html`, { timeout: TIMEOUT });
    assert(response.status === 200, 'Status should be 200');
    assert(response.data.includes('CryptoPay'), 'Should contain CryptoPay in HTML');
  });

  // Print Results
  console.log(`\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.blue}📊 Test Results${colors.reset}`);
  console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.green}✓ Passed: ${passedTests}${colors.reset}`);
  if (failedTests > 0) {
    console.log(`${colors.red}✗ Failed: ${failedTests}${colors.reset}`);
  }
  console.log(`  Total: ${passedTests + failedTests}`);
  console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  // Exit with appropriate code
  if (failedTests > 0) {
    process.exit(1);
  }
}

// Check if server is running before running tests
async function checkServer() {
  try {
    await axios.get(`${API_BASE}/api/health`, { timeout: TIMEOUT });
    return true;
  } catch (error) {
    return false;
  }
}

// Main execution
(async () => {
  console.log(`${colors.yellow}⏳ Checking if server is running...${colors.reset}`);

  const serverRunning = await checkServer();

  if (!serverRunning) {
    console.log(`${colors.red}✗ Server is not running at ${API_BASE}${colors.reset}`);
    console.log(`${colors.yellow}  Please start the server with: npm start${colors.reset}\n`);
    process.exit(1);
  }

  console.log(`${colors.green}✓ Server is running${colors.reset}\n`);

  await runTests();
})();
