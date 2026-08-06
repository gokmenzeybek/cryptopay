/**
 * Domain Event Bus
 *
 * Domain event bus for decoupled state change propagation. Handlers emit
 * events; services subscribe. Supports in-process EventEmitter. Future: add
 * Redis pub/sub for cross-node events.
 *
 * Usage:
 *   const { EVENTS, emit, on } = require('./eventBus');
 *   emit(EVENTS.ORDER_MATCHED, { orderId, counterparty });
 *   const unsubscribe = on(EVENTS.ORDER_MATCHED, (event) => { ... });
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

// Domain event types — single source of truth
const EVENTS = {
  ORDER_CREATED: 'order:created',
  ORDER_MATCHED: 'order:matched',
  ORDER_CANCELLED: 'order:cancelled',
  ORDER_COMPLETED: 'order:completed',
  PAYMENT_CONFIRMED: 'payment:confirmed',
  XRP_RECEIVED: 'xrp:received',
  ESCROW_LOCKED: 'escrow:locked',
  ESCROW_COMPLETED: 'escrow:completed',
  ESCROW_CANCELLED: 'escrow:cancelled',
  WALLET_BALANCE_CHANGED: 'wallet:balance_changed',
  PAPARA_PAYMENT_RECEIVED: 'papara:payment_received',
  DISPUTE_OPENED: 'dispute:opened',
  DISPUTE_RESOLVED: 'dispute:resolved'
};

// Local EventEmitter for in-process subscriptions
const localEmitter = new EventEmitter();
localEmitter.setMaxListeners(100); // Raise limit for many WS connections

/**
 * Emit a domain event to all local subscribers.
 * @param {string} eventType - One of EVENTS constants
 * @param {Object} payload - Event data
 */
function emit(eventType, payload) {
  if (!Object.values(EVENTS).includes(eventType)) {
    logger.warn(`Unknown event type: ${eventType}`);
  }

  const event = {
    type: eventType,
    payload,
    timestamp: new Date().toISOString(),
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  };

  localEmitter.emit(eventType, event);
  // Also emit wildcard for monitoring/logging
  localEmitter.emit('*', event);

  logger.debug(`Event emitted: ${eventType}`, { eventId: event.id });
  return event;
}

/**
 * Subscribe to a domain event.
 * @param {string} eventType - One of EVENTS constants, or '*' for all
 * @param {Function} handler - (event) => void
 * @returns {Function} Unsubscribe function
 */
function on(eventType, handler) {
  localEmitter.on(eventType, handler);
  return () => localEmitter.off(eventType, handler);
}

/**
 * Subscribe to a domain event once.
 * @param {string} eventType - One of EVENTS constants
 * @param {Function} handler - (event) => void
 */
function once(eventType, handler) {
  localEmitter.once(eventType, handler);
}

/**
 * Get list of all event types.
 * @returns {Object} EVENTS constant
 */
function getEventTypes() {
  return EVENTS;
}

module.exports = {
  EVENTS,
  emit,
  on,
  once,
  getEventTypes
};
