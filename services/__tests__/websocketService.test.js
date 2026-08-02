/**
 * WebSocket service hardening tests (PRD 5.1.3)
 *  - JWT via first message, not URL query string
 *  - no NODE_ENV test bypass
 *  - chat persisted to chat_messages table
 *  - chat history bounded to 200 messages
 */

process.env.CRYPTOPAY_SKIP_LISTEN = 'true';

const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

jest.mock('../../database/connection', () => ({
  pool: {
    query: jest.fn()
  }
}));

const { pool } = require('../../database/connection');
const { initWebSocketServer, broadcastOrderUpdate, wsClients } = require('../../services/websocketService');

const ADDRESS = 'r' + 'a'.repeat(33);
const OTHER_ADDRESS = 'r' + 'b'.repeat(33);

function token(address = ADDRESS) {
  return jwt.sign({ address }, process.env.JWT_SECRET);
}

function waitForMessage(ws, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeout);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForClose(ws, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), timeout);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('WebSocket service hardening', () => {
  let server;
  let wss;

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
    server = http.createServer();
    wss = initWebSocketServer(server);
  });

  afterEach((done) => {
    // Close all client sockets tracked by the service
    for (const [socket] of wsClients.entries()) {
      try { socket.terminate(); } catch (err) { /* ignore */ }
    }
    server.close(() => done());
  });

  function connect(query = '') {
    return new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const ws = new WebSocket(`ws://127.0.0.1:${port}${query ? '?' + query : ''}`);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
      });
    });
  }

  it('rejects non-auth actions before authentication', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const ws = await connect();
    ws.send(JSON.stringify({ action: 'join', orderId: 'order_1' }));
    const msg = await waitForMessage(ws);
    expect(msg.event).toBe('error');
    expect(msg.code).toBe(401);
    ws.close();
  });

  it('authenticates via the first message and accepts join afterwards', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, address: ADDRESS, is_active: true }] }) // auth
      .mockResolvedValueOnce({ rows: [{ order_id: 'order_1', xrpl_address: ADDRESS, counterparty_address: null }] }); // join

    const ws = await connect();
    ws.send(JSON.stringify({ action: 'auth', token: token() }));
    const authMsg = await waitForMessage(ws);
    expect(authMsg.event).toBe('authenticated');
    expect(authMsg.address).toBe(ADDRESS);

    ws.send(JSON.stringify({ action: 'join', orderId: 'order_1' }));
    const joinMsg = await waitForMessage(ws);
    expect(joinMsg.event).toBe('joined');
    expect(joinMsg.orderId).toBe('order_1');
    ws.close();
  });

  it('closes the connection on invalid auth token', async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ action: 'auth', token: 'invalid-token' }));
    const msg = await waitForMessage(ws);
    expect(msg.event).toBe('error');
    expect(msg.code).toBe(401);
    await waitForClose(ws);
  });

  it('persists chat messages to chat_messages table, not metadata', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, address: ADDRESS, is_active: true }] }) // auth
      .mockResolvedValueOnce({ rows: [{ order_id: 'order_1', xrpl_address: ADDRESS, counterparty_address: null }] }) // join
      .mockResolvedValueOnce({ rows: [{ order_id: 'order_1', xrpl_address: ADDRESS, counterparty_address: null }] }); // chat order lookup

    const ws = await connect();
    ws.send(JSON.stringify({ action: 'auth', token: token() }));
    await waitForMessage(ws); // authenticated

    ws.send(JSON.stringify({ action: 'join', orderId: 'order_1' }));
    await waitForMessage(ws); // joined

    ws.send(JSON.stringify({ action: 'chat', orderId: 'order_1', text: 'hello world' }));
    const chatMsg = await waitForMessage(ws);
    expect(chatMsg.event).toBe('chat_message');
    expect(chatMsg.data.text).toBe('hello world');

    // The third query after auth+join should be the INSERT into chat_messages
    const insertCalls = pool.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('INSERT INTO chat_messages')
    );
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0][1]).toEqual(['order_1', expect.any(String), 'hello world']);

    // No UPDATE to p2p_orders metadata should occur
    const metadataUpdateCalls = pool.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE p2p_orders SET metadata')
    );
    expect(metadataUpdateCalls.length).toBe(0);

    ws.close();
  });

  it('prunes chat history to MAX_CHAT_HISTORY messages', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, address: ADDRESS, is_active: true }] }) // auth
      .mockResolvedValueOnce({ rows: [{ order_id: 'order_1', xrpl_address: ADDRESS, counterparty_address: null }] }) // join
      .mockResolvedValueOnce({ rows: [{ order_id: 'order_1', xrpl_address: ADDRESS, counterparty_address: null }] }); // chat order lookup

    const ws = await connect();
    ws.send(JSON.stringify({ action: 'auth', token: token() }));
    await waitForMessage(ws);
    ws.send(JSON.stringify({ action: 'join', orderId: 'order_1' }));
    await waitForMessage(ws);
    ws.send(JSON.stringify({ action: 'chat', orderId: 'order_1', text: 'hello' }));
    await waitForMessage(ws);

    const pruneCalls = pool.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('DELETE FROM chat_messages')
    );
    expect(pruneCalls.length).toBe(1);
    expect(pruneCalls[0][1]).toEqual(['order_1', 200]);

    ws.close();
  });

  it('does not authenticate via URL query token', async () => {
    const ws = await connect(`token=${token()}`);
    ws.send(JSON.stringify({ action: 'join', orderId: 'order_1' }));
    const msg = await waitForMessage(ws);
    expect(msg.event).toBe('error');
    expect(msg.code).toBe(401);
    ws.close();
  });

  it('broadcasts order_status to authenticated sockets that did not join the room', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 1, address: ADDRESS, is_active: true }] });
    const ws = await connect();
    ws.send(JSON.stringify({ action: 'auth', token: token() }));
    const authMsg = await waitForMessage(ws);
    expect(authMsg.event).toBe('authenticated');

    broadcastOrderUpdate('order_1', 'completed');

    const updateMsg = await waitForMessage(ws);
    expect(updateMsg.event).toBe('order_status');
    expect(updateMsg.data).toEqual({ orderId: 'order_1', status: 'completed' });
    ws.close();
  });
});
