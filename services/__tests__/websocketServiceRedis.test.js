/**
 * Unit tests for the Redis pub/sub path in websocketService.js.
 * Verifies that when REDIS_URL is set the service subscribes to the order
 * status / chat channels and publishes broadcasts, without needing a live Redis.
 */

jest.mock('../redisClient');

const redisClient = require('../redisClient');
const { initWebSocketServer, broadcastOrderUpdate } = require('../websocketService');

const http = require('http');

const ORDER_STATUS_CHANNEL = 'cryptopay:order_status';
const CHAT_CHANNEL = 'cryptopay:chat';

const ORIG_REDIS_URL = process.env.REDIS_URL;

// Capture subscribe handlers so tests can simulate an incoming cross-node event.
const subscribedHandlers = new Map();

beforeEach(() => {
  jest.clearAllMocks();
  if (ORIG_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIG_REDIS_URL;
  process.env.REDIS_URL = 'rediss://default:secret@host.render.com:6379';

  redisClient.isRedisConfigured.mockReturnValue(true);
  redisClient.publish.mockResolvedValue(1);
  redisClient.subscribe.mockImplementation(async (channel, handler) => {
    if (!subscribedHandlers.has(channel)) subscribedHandlers.set(channel, new Set());
    subscribedHandlers.get(channel).add(handler);
    return () => subscribedHandlers.get(channel).delete(handler);
  });
  subscribedHandlers.clear();
});

afterAll(() => {
  if (ORIG_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIG_REDIS_URL;
});

test('subscribes to order-status and chat channels on init when Redis is configured', () => {
  const server = http.createServer();
  initWebSocketServer(server);
  server.close();

  expect(subscribedHandlers.has(ORDER_STATUS_CHANNEL)).toBe(true);
  expect(subscribedHandlers.has(CHAT_CHANNEL)).toBe(true);
});

test('broadcastOrderUpdate publishes to the order-status channel and stays local-delivery safe', async () => {
  const server = http.createServer();
  initWebSocketServer(server);
  server.close();

  broadcastOrderUpdate('order_9', 'completed');

  expect(redisClient.publish).toHaveBeenCalledWith(
    ORDER_STATUS_CHANNEL,
    JSON.stringify({ event: 'order_status', data: { orderId: 'order_9', status: 'completed' } })
  );
});

test('incoming cross-node order-status event is parsed and not re-published', async () => {
  const server = http.createServer();
  initWebSocketServer(server);
  server.close();

  redisClient.publish.mockClear();
  const handler = Array.from(subscribedHandlers.get(ORDER_STATUS_CHANNEL))[0];
  handler(JSON.stringify({ event: 'order_status', data: { orderId: 'order_7', status: 'matched' } }));

  // Forwarded locally (no sockets connected, so nothing crashes) and NOT looped
  // back out to Redis by the handler.
  expect(redisClient.publish).not.toHaveBeenCalled();
});