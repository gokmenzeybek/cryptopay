process.env.PORT = '5002';
process.env.NODE_ENV = 'development';
const axios = require('axios');
(async () => {
  require('./server.production.js');
  await new Promise(r => setTimeout(r, 1500));
  const get = async (url, opts) => {
    const r = await axios({ method: opts && opts.method || 'get', url: 'http://localhost:5002' + url, data: opts && opts.data, validateStatus: () => true });
    console.log((opts && opts.method || 'GET').toUpperCase(), url, '->', r.status, JSON.stringify(r.data).slice(0, 260));
  };
  await get('/api/transactions');
  await get('/api/stats');
  await get('/api/wallets', { method: 'post', data: { address: 'rTest12345678901234567890123456789', publicKey: 'ED123' } });
  await get('/api/transactions', { method: 'post', data: { hash: 'ABC123', from: 'rA', to: 'rB', amount: 5 } });
  await get('/api/payment_requests', { method: 'post', data: { fromAddress: 'rA', toAddress: 'rB', amount: 5 } });
  const r = await axios.options('http://localhost:5002/api', { validateStatus: () => true });
  console.log('OPTIONS /api ->', r.status, JSON.stringify(r.data).slice(0, 200));
  process.exit(0);
})();
