const ws = require('ws');
const jwt = require('jsonwebtoken');
const { pool } = require('../database/connection');
const logger = require('../utils/logger');
const { isRedisConfigured, publish, subscribe } = require('./redisClient');
const { EVENTS, on } = require('./eventBus');

// No fallback: JWT_SECRET is mandatory (validated at startup in production;
// provided by tests/setup.js under Jest).
const JWT_SECRET = process.env.JWT_SECRET;

// Global map to track active ws connections and their authenticated users
const wsClients = new Map();

// Room-indexed socket tracking for O(1) room broadcast (vs O(n) full scan).
// roomMembers.get(roomId) returns a Set of WebSocket instances that have joined
// that room. A single socket may appear in multiple rooms (one per order it
// has joined). Rooms with zero members are pruned to keep the index bounded.
const roomMembers = new Map(); // Map<string, Set<WebSocket>>

// Maximum chat messages retained per order
const MAX_CHAT_HISTORY = 200;

// WebSocket keepalive: server pings every 30s, terminates if no pong within 10s.
// Tuned for mobile clients on flaky networks — too-aggressive (sub-10s) pings
// waste battery and trigger false-positive terminations on transient hiccups.
const WS_HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const WS_HEARTBEAT_TIMEOUT_MS = 10000;  // 10 seconds to respond

// Track consecutive stalled sends per socket (for detecting stuck clients)
const socketStalls = new Map(); // Map<WebSocket, number>

// Track heartbeat state for each socket.
// Value: { lastPong: number, pingTimer: NodeJS.Timeout }
const socketHeartbeats = new Map(); // Map<WebSocket, { lastPong: number, pingTimer: NodeJS.Timeout }>

// Redis pub/sub channels for cross-node broadcasts. When REDIS_URL is set,
// order-status and chat events are published here so every app node forwards
// them to its own local sockets (Redis delivers to the other nodes only, so
// there is no double-delivery on the publishing node).
const ORDER_STATUS_CHANNEL = 'cryptopay:order_status';
const CHAT_CHANNEL = 'cryptopay:chat';

// Backpressure handling: skip send if client buffer exceeds 1MB; terminate after 5 consecutive stalls.
const WS_MAX_BUFFERED_BYTES = 1024 * 1024; // 1MB
const WS_STALL_THRESHOLD = 5; // consecutive stalled sends before terminating

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
 * Safely send data to a socket with backpressure handling.
 * Skips send if buffer is too full; terminates after consecutive stalls.
 * @param {WebSocket} socket - Target socket
 * @param {string} data - Data to send
 * @returns {boolean} True if sent, false if skipped
 */
function safeSocketSend(socket, data) {
  if (socket.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
    const stalls = (socketStalls.get(socket) || 0) + 1;
    socketStalls.set(socket, stalls);

    if (stalls >= WS_STALL_THRESHOLD) {
      try { socket.terminate(); } catch (err) { /* ignore */ }
      return false;
    }
    return false;
  }

  socketStalls.set(socket, 0);

  try {
    socket.send(data);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Deliver an order-status update to LOCAL sockets that should receive it:
 *   1. members of the order room (via the roomMembers index, O(1))
 *   2. authenticated sockets that did NOT join the room (live order book
 *      feed — see useOrderFeed hook, which authenticates but never joins
 *      rooms so it can refresh the global book without polling)
 *
 * Both audiences need every status change so the per-order view and the
 * global book stay in sync. Room members are delivered via the indexed
 * Set; the live-feed fan-out walks wsClients but skips sockets already
 * covered above and any that are not yet authenticated.
 */
function deliverOrderUpdateLocally(orderId, status) {
  const roomId = `order_${orderId}`;
  const members = roomMembers.get(roomId);

  const message = JSON.stringify({
    event: 'order_status',
    data: { orderId, status }
  });

  // 1) O(1) delivery to room members
  if (members) {
    for (const socket of members) {
      if (socket.readyState === ws.OPEN) {
        safeSocketSend(socket, message);
      }
    }
  }

  // 2) Live-feed fan-out: authenticated sockets not already in the room.
  for (const [socket, client] of wsClients) {
    if (!client.authenticated) continue;
    if (members && members.has(socket)) continue;
    if (socket.readyState === ws.OPEN) {
      safeSocketSend(socket, message);
    }
  }
}

/**
 * Deliver a wallet balance update to a specific user's connected sockets.
 * @param {string} xrplAddress - The wallet address to notify
 * @param {Object} update - { balance, reserved, available, currency, txHash }
 * @returns {number} Number of sockets the update was delivered to
 */
function deliverWalletUpdateLocally(xrplAddress, update) {
  const message = JSON.stringify({
    type: 'wallet_update',
    ...update,
    timestamp: new Date().toISOString()
  });

  let delivered = 0;
  for (const [socket, client] of wsClients) {
    if (client.authenticated && client.userContext && client.userContext.xrplAddress === xrplAddress) {
      if (socket.readyState === 1) { // ws.OPEN
        safeSocketSend(socket, message);
        delivered++;
      }
    }
  }
  return delivered;
}

/**
 * Get list of unique XRPL addresses with active WS connections.
 * @returns {string[]} Array of wallet addresses
 */
function getConnectedWalletAddresses() {
  const addresses = new Set();
  for (const [socket, client] of wsClients) {
    if (client.authenticated && client.userContext && client.userContext.xrplAddress) {
      addresses.add(client.userContext.xrplAddress);
    }
  }
  return Array.from(addresses);
}

/**
 * Deliver a chat message to the LOCAL sockets that joined the order room.
 * Uses the roomMembers index for O(1) lookup of room subscribers instead of
 * scanning every connected socket (O(n)). Chat is intentionally room-only —
 * the live order book feed must not see per-order chat.
 */
function deliverChatLocally(orderId, msg) {
  const roomId = `order_${orderId}`;
  const members = roomMembers.get(roomId);

  if (!members || members.size === 0) return;

  const payload = JSON.stringify({ event: 'chat_message', orderId, data: msg });

  for (const socket of members) {
    if (socket.readyState === ws.OPEN) {
      safeSocketSend(socket, payload);
    }
  }
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

    // Initialize heartbeat tracking. Use the per-socket `ws.ping()` (not the
    // server-level heartbeat helper) so we get explicit control over the
    // timeout window and can read `lastPong` for monitoring.
    socketHeartbeats.set(socket, { lastPong: Date.now() });

    // Set up ping timer: every interval, check whether we received a pong
    // within the timeout window, otherwise terminate. If `ping()` throws, the
    // socket is already in a bad state — terminate immediately.
    const pingTimer = setInterval(() => {
      const state = socketHeartbeats.get(socket);
      if (!state) return;

      // Check if last pong was received within the timeout window
      if (Date.now() - state.lastPong > WS_HEARTBEAT_INTERVAL_MS + WS_HEARTBEAT_TIMEOUT_MS) {
        const client = wsClients.get(socket);
        logger.debug('WebSocket heartbeat timeout, terminating', {
          address: (client && client.userContext && client.userContext.xrplAddress) || 'unauthenticated'
        });
        socket.terminate();
        return;
      }

      // Send ping
      try {
        socket.ping();
      } catch (err) {
        socket.terminate();
      }
    }, WS_HEARTBEAT_INTERVAL_MS);

    socketHeartbeats.get(socket).pingTimer = pingTimer;

    // Update lastPong on every pong frame. Browsers and the `ws` client both
    // emit pong frames automatically in response to a ping, so we do not have
    // to send anything in reply.
    socket.on('pong', () => {
      const state = socketHeartbeats.get(socket);
      if (state) {
        state.lastPong = Date.now();
      }
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
          // Mirror membership into the room index for O(1) broadcast lookup.
          const roomId = `order_${orderId}`;
          if (!roomMembers.has(roomId)) {
            roomMembers.set(roomId, new Set());
          }
          roomMembers.get(roomId).add(socket);
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
          deliverChatLocally(orderId, msg);
          if (isRedisConfigured()) {
            publish(CHAT_CHANNEL, JSON.stringify({ event: 'chat_message', orderId, data: msg })).catch(() => {});
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

      // Clean up room membership on disconnect — remove the socket from every
      // room it had joined and prune empty rooms to keep the index bounded.
      for (const [roomId, members] of roomMembers) {
        if (members.has(socket)) {
          members.delete(socket);
          if (members.size === 0) {
            roomMembers.delete(roomId);
          }
        }
      }

      // Clean up heartbeat tracking: clear the ping timer so it does not fire
      // against a closed socket, and drop the entry from the map.
      const heartbeatState = socketHeartbeats.get(socket);
      if (heartbeatState && heartbeatState.pingTimer) {
        clearInterval(heartbeatState.pingTimer);
      }
      socketHeartbeats.delete(socket);
      socketStalls.delete(socket);
    });
  });

  // Cross-node broadcasts: when Redis is configured, subscribe to the order
  // status and chat channels and forward incoming events to this node's local
  // sockets. Fallback mode (no REDIS_URL) skips this entirely — the local
  // delivery helpers below are all that is needed on a single node.
  if (isRedisConfigured()) {
    subscribe(ORDER_STATUS_CHANNEL, (message) => {
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.event === 'order_status' && parsed.data) {
          deliverOrderUpdateLocally(parsed.data.orderId, parsed.data.status);
        }
      } catch (err) {
        logger.warn('Ignoring malformed order-status broadcast', { error: err.message });
      }
    }).catch(() => {});

    subscribe(CHAT_CHANNEL, (message) => {
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.event === 'chat_message' && parsed.orderId && parsed.data) {
          deliverChatLocally(parsed.orderId, parsed.data);
        }
      } catch (err) {
        logger.warn('Ignoring malformed chat broadcast', { error: err.message });
      }
    }).catch(() => {});
  }

  // Domain event subscriptions — forwards events to connected WS clients
  on(EVENTS.ORDER_MATCHED, (event) => {
    if (event.payload && event.payload.orderId) {
      broadcastOrderUpdate(event.payload.orderId, 'matched');
    }
  });

  on(EVENTS.ORDER_COMPLETED, (event) => {
    if (event.payload && event.payload.orderId) {
      broadcastOrderUpdate(event.payload.orderId, 'completed');
    }
  });

  on(EVENTS.ORDER_CANCELLED, (event) => {
    if (event.payload && event.payload.orderId) {
      broadcastOrderUpdate(event.payload.orderId, 'cancelled');
    }
  });

  on(EVENTS.PAYMENT_CONFIRMED, (event) => {
    if (event.payload && event.payload.orderId) {
      broadcastOrderUpdate(event.payload.orderId, 'payment_confirmed');
    }
  });

  on(EVENTS.ESCROW_LOCKED, (event) => {
    if (event.payload && event.payload.orderId) {
      broadcastOrderUpdate(event.payload.orderId, 'escrow_locked');
    }
  });

  on(EVENTS.ESCROW_COMPLETED, (event) => {
    if (event.payload && event.payload.orderId) {
      broadcastOrderUpdate(event.payload.orderId, 'escrow_completed');
    }
  });

  // Subscribe to wallet balance change events
  on(EVENTS.WALLET_BALANCE_CHANGED, (event) => {
    if (event.payload && event.payload.xrplAddress) {
      deliverWalletUpdateLocally(event.payload.xrplAddress, {
        balance: event.payload.balance,
        reserved: event.payload.reserved,
        available: event.payload.available,
        currency: event.payload.currency || 'XRP',
        txHash: event.payload.txHash
      });
    }
  });

  return { wss, wsClients };
}

/**
 * Broadcast order status update to participants in order room.
 * Also broadcasts to every authenticated socket so the live order book feed
 * (see useOrderFeed hook) can refresh on demand without polling.
 */
function broadcastOrderUpdate(orderId, status) {
  deliverOrderUpdateLocally(orderId, status);
  if (isRedisConfigured()) {
    publish(ORDER_STATUS_CHANNEL, JSON.stringify({ event: 'order_status', data: { orderId, status } })).catch(() => {});
  }
}

/**
 * Get the number of connected sockets in a room.
 * @param {string} roomId - Room identifier (e.g., 'order_123')
 * @returns {number} Number of socket members
 */
function getRoomMemberCount(roomId) {
  return roomMembers.has(roomId) ? roomMembers.get(roomId).size : 0;
}

/**
 * Count sockets whose last pong is older than the heartbeat window.
 * Exposed for monitoring / health endpoints to surface dead-connection
 * pressure before the next sweep actually terminates them.
 */
function getDeadConnectionCount() {
  const now = Date.now();
  let dead = 0;
  for (const [, state] of socketHeartbeats) {
    if (now - state.lastPong > WS_HEARTBEAT_INTERVAL_MS + WS_HEARTBEAT_TIMEOUT_MS) {
      dead++;
    }
  }
  return dead;
}

function getStalledConnections() {
  let count = 0;
  for (const [socket, stalls] of socketStalls) {
    if (stalls > 0) count++;
  }
  return count;
}

function getAverageBufferUsage() {
  let total = 0, count = 0;
  for (const [socket] of wsClients) {
    total += socket.bufferedAmount;
    count++;
  }
  return count > 0 ? Math.round(total / count) : 0;
}

module.exports = {
  initWebSocketServer,
  broadcastOrderUpdate,
  getRoomMemberCount,
  deliverWalletUpdateLocally,
  getConnectedWalletAddresses,
  getDeadConnectionCount,
  safeSocketSend,
  getStalledConnections,
  getAverageBufferUsage,
  wsClients
};
