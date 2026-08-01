const ws = require('ws');
const jwt = require('jsonwebtoken');
const { pool } = require('../database/connection');
const logger = require('../utils/logger');

// No fallback: JWT_SECRET is mandatory (validated at startup in production;
// provided by tests/setup.js under Jest).
const JWT_SECRET = process.env.JWT_SECRET;

// Global map to track active ws connections and their authenticated users
const wsClients = new Map();

// Maximum chat messages retained per order
const MAX_CHAT_HISTORY = 200;

/**
 * Authenticate a WebSocket connection from an `auth` message payload.
 * Returns a user context object on success, or null on failure.
 */
async function authenticateSocket(token) {
  if (!token) return null;

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }

  if (!decoded || (!decoded.address && !decoded.xrplAddress)) {
    return null;
  }

  const address = decoded.address || decoded.xrplAddress;

  // Query database to ensure wallet exists and is active
  const result = await pool.query(
    'SELECT id, address, is_active FROM wallets WHERE address = $1',
    [address]
  );

  if (result.rows.length === 0 || !result.rows[0].is_active) {
    return null;
  }

  const dbUser = result.rows[0];
  return {
    id: dbUser.id,
    address: dbUser.address,
    xrplAddress: dbUser.address,
    username: decoded.username || `User_${dbUser.address.substring(0, 8)}`
  };
}

/**
 * Initialize WebSocket Server and attach upgrade handler
 */
function initWebSocketServer(server) {
  const wss = new ws.Server({ noServer: true });

  // Accept every upgrade; authentication happens via the first message.
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (wsSocket) => {
      wss.emit('connection', wsSocket, request, null);
    });
  });

  wss.on('connection', (socket, request, userContext) => {
    // Connections start unauthenticated; they must send an `auth` message first.
    wsClients.set(socket, {
      authenticated: false,
      userContext: null,
      rooms: new Set(),
      messageTimestamps: []
    });

    socket.on('message', async (data) => {
      const client = wsClients.get(socket);
      if (!client) return;

      try {
        // Socket-level rate limiting / throttling: max 5 messages per 10 seconds
        const now = Date.now();
        client.messageTimestamps = client.messageTimestamps.filter(t => now - t < 10000);
        if (client.messageTimestamps.length >= 5) {
          socket.send(JSON.stringify({ event: 'error', code: 429, message: 'Too many messages. Throttled.' }));
          return;
        }
        client.messageTimestamps.push(now);

        const packet = JSON.parse(data.toString());
        const { action, orderId, text, token: authToken } = packet;

        // Authentication must be the first action on an unauthenticated socket.
        if (action === 'auth') {
          const authenticatedUser = await authenticateSocket(authToken);
          if (!authenticatedUser) {
            socket.send(JSON.stringify({ event: 'error', code: 401, message: 'Authentication failed' }));
            socket.close(1008, 'Authentication failed');
            return;
          }
          client.authenticated = true;
          client.userContext = authenticatedUser;
          socket.send(JSON.stringify({ event: 'authenticated', address: authenticatedUser.address }));
          return;
        }

        if (!client.authenticated || !client.userContext) {
          socket.send(JSON.stringify({ event: 'error', code: 401, message: 'Not authenticated. Send auth first.' }));
          return;
        }

        const userContext = client.userContext;

        if (action === 'join') {
          const orderResult = await pool.query('SELECT * FROM p2p_orders WHERE order_id = $1', [orderId]);
          if (orderResult.rows.length === 0) {
            socket.send(JSON.stringify({ event: 'error', message: 'Order not found' }));
            return;
          }
          const order = orderResult.rows[0];
          const userAddress = userContext.xrplAddress;
          if (userAddress !== order.xrpl_address && userAddress !== order.counterparty_address) {
            socket.send(JSON.stringify({ event: 'error', code: 403, message: 'Forbidden: Not a participant' }));
            return;
          }

          client.rooms.add(`order_${orderId}`);
          socket.send(JSON.stringify({ event: 'joined', orderId }));
          return;
        }

        if (action === 'chat') {
          if (!client.rooms.has(`order_${orderId}`)) {
            socket.send(JSON.stringify({ event: 'error', message: 'Must join room first' }));
            return;
          }
          if (!text || text.trim() === '') {
            socket.send(JSON.stringify({ event: 'error', message: 'Empty message' }));
            return;
          }

          const orderResult = await pool.query('SELECT * FROM p2p_orders WHERE order_id = $1', [orderId]);
          if (orderResult.rows.length === 0) {
            socket.send(JSON.stringify({ event: 'error', message: 'Order not found' }));
            return;
          }

          const msg = {
            sender: userContext.username,
            text: text.trim(),
            timestamp: new Date().toISOString()
          };

          // Persist chat to a dedicated table instead of p2p_orders.metadata.
          await pool.query(
            'INSERT INTO chat_messages (order_id, sender, text) VALUES ($1, $2, $3)',
            [orderId, msg.sender, msg.text]
          );

          // Keep per-order history bounded to MAX_CHAT_HISTORY messages.
          await pool.query(
            `DELETE FROM chat_messages
             WHERE id IN (
               SELECT id FROM chat_messages
               WHERE order_id = $1
               ORDER BY created_at DESC
               OFFSET $2
             )`,
            [orderId, MAX_CHAT_HISTORY]
          );

          // Broadcast to all clients in this order room
          const payload = JSON.stringify({ event: 'chat_message', data: msg });
          for (const [otherSocket, otherClient] of wsClients.entries()) {
            if (
              otherSocket.readyState === ws.OPEN &&
              otherClient.rooms &&
              otherClient.rooms.has(`order_${orderId}`)
            ) {
              otherSocket.send(payload);
            }
          }
          return;
        }

        if (action === 'history') {
          if (!client.rooms.has(`order_${orderId}`)) {
            socket.send(JSON.stringify({ event: 'error', message: 'Must join room first' }));
            return;
          }
          const historyResult = await pool.query(
            `SELECT sender, text, created_at AS timestamp
             FROM chat_messages
             WHERE order_id = $1
             ORDER BY created_at ASC
             LIMIT $2`,
            [orderId, MAX_CHAT_HISTORY]
          );
          socket.send(JSON.stringify({ event: 'chat_history', orderId, messages: historyResult.rows }));
          return;
        }

        socket.send(JSON.stringify({ event: 'error', message: 'Unknown action' }));
      } catch (err) {
        logger.error('WebSocket message error:', err);
        socket.send(JSON.stringify({ event: 'error', message: err.message }));
      }
    });

    socket.on('close', () => {
      wsClients.delete(socket);
    });
  });

  return { wss, wsClients };
}

/**
 * Broadcast order status update to participants in order room
 */
function broadcastOrderUpdate(orderId, status) {
  const payload = JSON.stringify({ event: 'order_status', data: { orderId, status } });
  for (const [client, clientData] of wsClients.entries()) {
    if (client.readyState === ws.OPEN && clientData.rooms && clientData.rooms.has(`order_${orderId}`)) {
      client.send(payload);
    }
  }
}

module.exports = {
  initWebSocketServer,
  broadcastOrderUpdate,
  wsClients
};
