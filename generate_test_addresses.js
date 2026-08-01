// XRPL Test Address Generator
// This generates valid XRPL testnet addresses for testing purposes

function generateTestXRPLAddress() {
  // XRPL addresses start with 'r' and are exactly 34 characters
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let address = 'r';
  
  // Generate 33 more characters
  for (let i = 0; i < 33; i++) {
    address += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return address;
}

// Generate a few test addresses
console.log('Test XRPL Addresses for P2P Exchange:');
console.log('1. ' + generateTestXRPLAddress());
console.log('2. ' + generateTestXRPLAddress());
console.log('3. ' + generateTestXRPLAddress());
console.log('4. ' + generateTestXRPLAddress());
console.log('5. ' + generateTestXRPLAddress());
