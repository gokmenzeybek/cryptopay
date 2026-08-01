#!/usr/bin/env node

/**
 * P2P API Test Script
 * Tests all P2P endpoints against the API guide examples
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5001';

// Test data
const testData = {
  xrplAddress: 'rTest123456789012345678901234567890',
  order: {
    type: 'buy',
    tryAmount: 1000,
    xrpAmount: 54.2,
    rate: 18.45,
    xrplAddress: 'rTest123456789012345678901234567890',
    paymentMethods: ['papara', 'bank_transfer'],
    minAmount: 500,
    maxAmount: 5000,
    timeLimit: 30,
    metadata: {
      name: 'Test User',
      completedTrades: 15,
      rating: 4.8
    }
  }
};

async function testEndpoint(name, method, url, data = null, expectedStatus = 200) {
  try {
    console.log(`\n🧪 Testing ${name}...`);
    console.log(`${method.toUpperCase()} ${url}`);
    
    const response = await axios({
      method,
      url: `${BASE_URL}${url}`,
      data,
      timeout: 10000
    });

    console.log(`✅ Status: ${response.status}`);
    console.log(`📊 Response:`, JSON.stringify(response.data, null, 2));
    
    if (response.status !== expectedStatus) {
      throw new Error(`Expected status ${expectedStatus}, got ${response.status}`);
    }
    
    return response.data;
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    if (error.response) {
      console.log(`📊 Error Response:`, JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

async function runTests() {
  console.log('🚀 Starting P2P API Tests...\n');
  
  try {
    // Test 1: Get payment methods
    await testEndpoint('Payment Methods', 'GET', '/api/p2p/payment-methods');
    
    // Test 2: Get current rate
    await testEndpoint('Current Rate', 'GET', '/api/p2p/rate');
    
    // Test 3: Create order
    const createResponse = await testEndpoint('Create Order', 'POST', '/api/p2p/create-order', testData.order, 200);
    const orderId = createResponse.order.id;
    
    // Test 4: Get orders
    await testEndpoint('Get Orders', 'GET', '/api/p2p/orders');
    
    // Test 5: Get user orders
    await testEndpoint('User Orders', 'GET', `/api/p2p/my-orders/${testData.xrplAddress}`);
    
    // Test 6: Get P2P stats
    await testEndpoint('P2P Stats', 'GET', '/api/p2p/stats');
    
    // Test 7: Cancel order
    await testEndpoint('Cancel Order', 'POST', '/api/p2p/cancel', {
      orderId: orderId,
      reason: 'Test cancellation'
    });
    
    console.log('\n🎉 All P2P API tests completed successfully!');
    
  } catch (error) {
    console.log('\n💥 Test failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests, testEndpoint };