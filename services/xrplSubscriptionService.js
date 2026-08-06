const logger = require('../utils/logger');
const { EventEmitter } = require('events');

const txEvents = new EventEmitter();
txEvents.setMaxListeners(100);

let subscribedAddresses = new Set();
let subscriptionClient = null;
let isSubscribing = false;

async function initSubscriptions(client) {
  if (isSubscribing) return;

  subscriptionClient = client;
  isSubscribing = true;

  try {
    if (subscribedAddresses.size > 0) {
      await subscribeToAddresses(Array.from(subscribedAddresses));
    }

    subscriptionClient.on('transaction', (tx) => {
      handleTransaction(tx);
    });

    subscriptionClient.on('disconnected', () => {
      logger.warn('XRPL subscription disconnected');
      isSubscribing = false;
      setTimeout(() => {
        if (!isSubscribing) {
          reconnectSubscriptions();
        }
      }, 5000);
    });

    logger.info('XRPL subscriptions initialized', { addressCount: subscribedAddresses.size });
  } catch (err) {
    logger.error('Failed to initialize XRPL subscriptions', { error: err.message });
    isSubscribing = false;
    throw err;
  }
}

async function subscribeToAddresses(addresses) {
  if (!subscriptionClient || !subscriptionClient.isConnected()) {
    logger.warn('Cannot subscribe: client not connected');
    return;
  }

  try {
    await subscriptionClient.request({
      command: 'subscribe',
      accounts: addresses
    });

    addresses.forEach(addr => subscribedAddresses.add(addr));
    logger.debug('Subscribed to addresses', { count: addresses.length });
  } catch (err) {
    logger.error('Subscribe request failed', { error: err.message });
    throw err;
  }
}

async function unsubscribeFromAddresses(addresses) {
  if (!subscriptionClient || !subscriptionClient.isConnected()) return;

  try {
    await subscriptionClient.request({
      command: 'unsubscribe',
      accounts: addresses
    });

    addresses.forEach(addr => subscribedAddresses.delete(addr));
    logger.debug('Unsubscribed from addresses', { count: addresses.length });
  } catch (err) {
    logger.error('Unsubscribe request failed', { error: err.message });
  }
}

function trackTransaction(txHash, options = {}) {
  const timeout = options.timeout || 30000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      txEvents.removeListener(`tx:${txHash}`, handler);
      reject(new Error(`Transaction tracking timeout: ${txHash}`));
    }, timeout);

    function handler(result) {
      clearTimeout(timer);
      resolve(result);
    }

    txEvents.once(`tx:${txHash}`, handler);
  });
}

function handleTransaction(tx) {
  if (!tx || !tx.transaction) return;

  const txHash = tx.transaction.hash;
  if (!txHash) return;

  if (!tx.validated) return;

  const result = {
    hash: txHash,
    type: tx.transaction.TransactionType,
    ledgerIndex: tx.ledger_index,
    source: tx.transaction.Account,
    destination: tx.transaction.Destination,
    amount: tx.transaction.Amount,
    fee: tx.transaction.Fee,
    result: tx.meta?.TransactionResult,
    validated: true,
    timestamp: new Date().toISOString()
  };

  logger.debug('XRPL subscription received transaction', {
    hash: txHash,
    type: result.type,
    result: result.result
  });

  txEvents.emit(`tx:${txHash}`, result);

  if (result.destination) {
    txEvents.emit(`address:${result.destination}`, result);
  }
}

async function reconnectSubscriptions() {
  try {
    const { getClient } = require('./xrplClientService');
    const client = await getClient();
    await initSubscriptions(client);
  } catch (err) {
    logger.error('Subscription reconnect failed', { error: err.message });
  }
}

function getSubscriptionMetrics() {
  return {
    subscribedAddresses: Array.from(subscribedAddresses),
    isSubscribing,
    addressCount: subscribedAddresses.size
  };
}

module.exports = {
  initSubscriptions,
  subscribeToAddresses,
  unsubscribeFromAddresses,
  trackTransaction,
  getSubscriptionMetrics
};
