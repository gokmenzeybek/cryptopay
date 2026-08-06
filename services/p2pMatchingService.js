/**
 * P2P Matching Service for TRY-XRP Conversions
 * Connects buyers (who have TRY) with sellers (who have XRP)
 * No third-party payment processors required
 */

const crypto = require('crypto');
const { PaparaService } = require('./paparaService');
const xrplEscrowService = require('./xrplEscrowService');
const xrplVerificationService = require('./xrplVerificationService');
const PaparaPaymentsDAL = require('../database/dal/paparaPayments');
const logger = require('../utils/logger');

/**
 * Mask an account number for logging (PII): all but the last 4 digits.
 */
function maskAccountNumber(accountNumber) {
  const value = String(accountNumber || '');
  return `******${value.slice(-4)}`;
}

/**
 * Normalize an order object in place so both camelCase (service) and
 * snake_case (database row) field names are usable interchangeably.
 */
function normalizeOrder(order) {
  if (!order) return order;
  if (order.type === undefined && order.order_type !== undefined) order.type = order.order_type;
  if (order.xrplAddress === undefined && order.xrpl_address !== undefined) order.xrplAddress = order.xrpl_address;
  if (order.paymentMethods === undefined && order.payment_methods !== undefined) order.paymentMethods = order.payment_methods || [];
  if (order.minAmount === undefined && order.min_amount !== undefined) order.minAmount = order.min_amount;
  if (order.maxAmount === undefined && order.max_amount !== undefined) order.maxAmount = order.max_amount;
  if (order.expiresAt === undefined && order.expires_at !== undefined) order.expiresAt = order.expires_at;
  if (order.matchedOrderId === undefined && order.counterparty_order_id !== undefined) order.matchedOrderId = order.counterparty_order_id;
  if (order.counterpartyAddress === undefined && order.counterparty_address !== undefined) order.counterpartyAddress = order.counterparty_address;
  if (order.escrowStatus === undefined && order.escrow_status !== undefined) order.escrowStatus = order.escrow_status;
  return order;
}

// Order types
const ORDER_TYPE = {
  BUY: 'buy',   // User wants to buy XRP with TRY
  SELL: 'sell'  // User wants to sell XRP for TRY
};

// Order status
const ORDER_STATUS = {
  OPEN: 'open',               // Order is active and looking for matches
  MATCHED: 'matched',         // Order has been matched with counterparty
  PAYMENT_CONFIRMED: 'payment_confirmed',  // TRY payment confirmed
  COMPLETED: 'completed',     // Both TRY and XRP transferred
  CANCELLED: 'cancelled',     // Order cancelled
  DISPUTED: 'disputed',       // Dispute raised
  EXPIRED: 'expired'          // Order expired without match
};

/**
 * The trade state machine (single source of truth, PRD 3.1.3).
 * Reference flow: open → matched → payment_confirmed → completed,
 * with cancelled (from open/matched), disputed (from matched/payment_confirmed),
 * and expired (from open). matched → open is the counterparty reopen when a
 * match is dissolved. disputed → completed/cancelled is moderator resolution.
 */
const ORDER_TRANSITIONS = {
  [ORDER_STATUS.OPEN]: [ORDER_STATUS.MATCHED, ORDER_STATUS.CANCELLED, ORDER_STATUS.EXPIRED],
  [ORDER_STATUS.MATCHED]: [ORDER_STATUS.PAYMENT_CONFIRMED, ORDER_STATUS.CANCELLED, ORDER_STATUS.DISPUTED, ORDER_STATUS.OPEN],
  [ORDER_STATUS.PAYMENT_CONFIRMED]: [ORDER_STATUS.COMPLETED, ORDER_STATUS.DISPUTED],
  [ORDER_STATUS.DISPUTED]: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.COMPLETED]: [],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.EXPIRED]: []
};

/**
 * Check whether a status transition is allowed by the state machine.
 */
function canTransition(fromStatus, toStatus) {
  return (ORDER_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

/**
 * Transition an order to a new status, rejecting illegal transitions.
 * ALL order status writes must go through this helper.
 *
 * @param {object} order — mutated in place
 * @param {string} toStatus — target status (ORDER_STATUS value)
 * @returns {object} the order
 */
function transitionOrder(order, toStatus) {
  const fromStatus = order.status;
  if (!canTransition(fromStatus, toStatus)) {
    throw new Error(`Illegal order status transition: ${fromStatus} → ${toStatus}`);
  }
  order.status = toStatus;
  return order;
}

// Payment methods for TRY
const PAYMENT_METHODS = {
  BANK_TRANSFER: 'bank_transfer',
  PAPARA: 'papara',
  ININAL: 'ininal',
  MEFETE: 'mefete',
  QR_HAVALE: 'qr_havale'
};

/**
 * Generate unique order ID
 */
function generateOrderId(type) {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `${type}_${timestamp}_${random}`;
}

/**
 * Create P2P order
 */
function createP2POrder(orderData) {
  const {
    type,           // 'buy' or 'sell'
    tryAmount,      // Amount in TRY
    xrpAmount,      // Amount in XRP
    rate,           // TRY per XRP rate
    xrplAddress,    // User's XRPL address
    paymentMethods, // Array of accepted payment methods
    minAmount,      // Minimum order amount (optional)
    maxAmount,      // Maximum order amount (optional)
    timeLimit,      // Time limit for payment in minutes (default: 30)
    metadata        // Additional user info (name, contact, etc.)
  } = orderData;

  const now = Date.now();
  const timeLimitMs = (timeLimit || 30) * 60 * 1000;

  const order = {
    id: generateOrderId(type),
    type: type,
    status: ORDER_STATUS.OPEN,

    // Amounts
    tryAmount: parseFloat(tryAmount),
    xrpAmount: parseFloat(xrpAmount),
    rate: parseFloat(rate),
    minAmount: minAmount ? parseFloat(minAmount) : null,
    maxAmount: maxAmount ? parseFloat(maxAmount) : null,

    // User info
    xrplAddress: xrplAddress,
    paymentMethods: Array.isArray(paymentMethods) ? paymentMethods : [paymentMethods],

    // Timestamps
    createdAt: new Date().toISOString(),
    expiresAt: new Date(now + timeLimitMs).toISOString(),
    timeLimitMinutes: timeLimit || 30,

    // Matching
    matchedOrderId: null,
    matchedAt: null,
    counterpartyAddress: null,
    counterpartyPaymentMethod: null,

    // Payment tracking
    paymentConfirmedAt: null,
    xrpTransactionHash: null,
    xrpConfirmedAt: null,
    completedAt: null,

    // Metadata
    metadata: metadata || {},

    // Escrow (for security)
    escrowEnabled: true,
    escrowAddress: null,
    escrowStatus: 'none',

    // Dispute
    disputeReason: null,
    disputeRaisedAt: null,

    // Stats
    completedTrades: metadata?.completedTrades || 0,
    rating: metadata?.rating || null
  };

  return order;
}

/**
 * Find matching orders
 */
function findMatchingOrders(order, allOrders) {
  normalizeOrder(order);
  const oppositeType = order.type === ORDER_TYPE.BUY ? ORDER_TYPE.SELL : ORDER_TYPE.BUY;

  const matches = allOrders.filter(o => {
    normalizeOrder(o);
    // Must be opposite type and open status
    if (o.type !== oppositeType || o.status !== ORDER_STATUS.OPEN) {
      return false;
    }

    // Must not be expired
    if (new Date(o.expiresAt) < new Date()) {
      return false;
    }

    // Don't match with own orders
    if (o.xrplAddress === order.xrplAddress) {
      return false;
    }

    // Check if rates are compatible
    // Buyer wants low rate, seller wants high rate
    if (order.type === ORDER_TYPE.BUY) {
      // Buyer's max rate should be >= seller's min rate
      if (order.rate < o.rate) {
        return false;
      }
    } else {
      // Seller's min rate should be <= buyer's max rate
      if (order.rate > o.rate) {
        return false;
      }
    }

    // Check if amounts are compatible
    if (o.minAmount && order.tryAmount < o.minAmount) {
      return false;
    }
    if (o.maxAmount && order.tryAmount > o.maxAmount) {
      return false;
    }

    // Check if payment methods are compatible
    const hasCommonPaymentMethod = order.paymentMethods.some(pm =>
      o.paymentMethods.includes(pm)
    );
    if (!hasCommonPaymentMethod) {
      return false;
    }

    return true;
  });

  // Sort matches by best rate and highest reputation
  matches.sort((a, b) => {
    // Prioritize by rating
    const ratingDiff = (b.rating || 0) - (a.rating || 0);
    if (ratingDiff !== 0) return ratingDiff;

    // Then by completed trades
    const tradesDiff = (b.completedTrades || 0) - (a.completedTrades || 0);
    if (tradesDiff !== 0) return tradesDiff;

    // Then by rate (better rate first)
    if (order.type === ORDER_TYPE.BUY) {
      return a.rate - b.rate; // Lower rate is better for buyers
    } else {
      return b.rate - a.rate; // Higher rate is better for sellers
    }
  });

  return matches;
}

/**
 * Match two orders
 */
function matchOrders(order1, order2) {
  normalizeOrder(order1);
  normalizeOrder(order2);

  // Determine final rate (use average or buyer's rate)
  const finalRate = order1.type === ORDER_TYPE.BUY ? order1.rate : order2.rate;

  // Determine final amount (use minimum of both)
  const finalTryAmount = Math.min(order1.tryAmount || order1.amount_try, order2.tryAmount || order2.amount_try);
  const finalXrpAmount = finalTryAmount / finalRate;

  // Determine payment method (first common method)
  const commonMethods = order1.paymentMethods.filter(pm =>
    order2.paymentMethods.includes(pm)
  );
  const paymentMethod = commonMethods[0];

  const now = new Date().toISOString();

  // Update order1
  transitionOrder(order1, ORDER_STATUS.MATCHED);
  order1.matchedOrderId = order2.order_id || order2.id;
  order1.matchedAt = now;
  order1.counterpartyAddress = order2.xrplAddress;
  order1.counterpartyPaymentMethod = paymentMethod;
  order1.finalTryAmount = finalTryAmount;
  order1.finalXrpAmount = finalXrpAmount;
  order1.finalRate = finalRate;

  // Update order2
  transitionOrder(order2, ORDER_STATUS.MATCHED);
  order2.matchedOrderId = order1.order_id || order1.id;
  order2.matchedAt = now;
  order2.counterpartyAddress = order1.xrplAddress;
  order2.counterpartyPaymentMethod = paymentMethod;
  order2.finalTryAmount = finalTryAmount;
  order2.finalXrpAmount = finalXrpAmount;
  order2.finalRate = finalRate;

  // Prepare escrow: seller locks XRP for the buyer on the XRPL.
  // The crypto-condition is generated per-escrow at prepare-escrow time
  // (random preimage), not at match time.
  const buyOrder = order1.type === ORDER_TYPE.BUY ? order1 : order2;
  const sellOrder = order1.type === ORDER_TYPE.BUY ? order2 : order1;
  const escrowCancelAfter = new Date(Date.now() + xrplEscrowService.CANCEL_AFTER_SECONDS * 1000).toISOString();

  [buyOrder, sellOrder].forEach(o => {
    o.escrowEnabled = true;
    o.escrowStatus = xrplEscrowService.ESCROW_STATUS.PREPARED;
    o.escrowOwner = sellOrder.xrplAddress;
    o.escrowCancelAfter = escrowCancelAfter;
  });

  return {
    order1: order1,
    order2: order2,
    match: {
      tryAmount: finalTryAmount,
      xrpAmount: finalXrpAmount,
      rate: finalRate,
      paymentMethod: paymentMethod
    },
    escrow: {
      status: xrplEscrowService.ESCROW_STATUS.PREPARED,
      owner: sellOrder.xrplAddress,
      destination: buyOrder.xrplAddress,
      xrpAmount: finalXrpAmount,
      cancelAfter: escrowCancelAfter
    }
  };
}


/**
 * Confirm XRP transfer. Verifies the Payment transaction on the XRPL ledger
 * before marking the order completed. Requires an active XRPL client.
 *
 * @param {object} order
 * @param {string} xrpTransactionHash — 64-char hex tx hash
 * @param {object} xrplClient — connected XRPL Client instance
 * @returns {Promise<object>} updated order
 */
async function confirmXrpTransfer(order, xrpTransactionHash, xrplClient) {
  if (order.status !== ORDER_STATUS.PAYMENT_CONFIRMED) {
    throw new Error(`Cannot confirm XRP for order in status: ${order.status}`);
  }

  if (!xrplClient) {
    throw new Error('XRPL client is required for on-chain verification');
  }

  // Determine the buyer's XRPL address (the expected payment destination)
  const isBuyOrder = (order.order_type || order.type) === 'buy';
  const buyerAddress = isBuyOrder
    ? (order.xrpl_address || order.xrplAddress)
    : (order.counterparty_address || order.counterpartyAddress);

  if (!buyerAddress) {
    throw new Error('Cannot determine buyer address for on-chain verification');
  }

  // Determine the expected XRP amount for this trade (DAL returns numeric
  // columns as strings, so coerce before passing to the verifier which
  // requires Number.isFinite).
  const expectedXrpAmount = Number(order.finalXrpAmount || order.final_xrp_amount
    || order.xrpAmount || order.amount_xrp);
  if (!Number.isFinite(expectedXrpAmount) || expectedXrpAmount <= 0) {
    throw new Error('Cannot determine expected XRP amount for on-chain verification');
  }

  const verifyResult = await xrplVerificationService.verifyPayment(xrplClient, {
    hash: xrpTransactionHash,
    expectedDestination: buyerAddress,
    minAmountXrp: expectedXrpAmount
  });

  if (!verifyResult.verified) {
    throw new Error(`XRP transfer verification failed: ${verifyResult.reason}`);
  }

  transitionOrder(order, ORDER_STATUS.COMPLETED);
  order.xrpTransactionHash = xrpTransactionHash;
  order.xrpConfirmedAt = new Date().toISOString();
  order.completedAt = new Date().toISOString();

  return order;
}

/**
 * Lock escrow for a matched trade. Verifies the EscrowCreate transaction
 * on the XRPL ledger before the caller marks the escrow as locked.
 * Only the seller (escrow owner) may submit the hash.
 *
 * @param {object} order
 * @param {object} params
 * @param {string} params.txHash — 64-char hex EscrowCreate tx hash
 * @param {number} params.offerSequence — Sequence of the EscrowCreate tx
 * @param {string} params.callerAddress — XRPL address of the authenticated caller
 * @param {object} xrplClient — connected XRPL Client instance
 * @returns {Promise<object>} the order (unchanged; caller persists escrow fields)
 */
async function lockEscrowForOrder(order, { txHash, offerSequence, callerAddress }, xrplClient) {
  if (!xrplClient) {
    throw new Error('XRPL client is required for on-chain verification');
  }

  // Determine seller (escrow owner) and buyer (escrow destination)
  const isSellOrder = (order.order_type || order.type) === 'sell';
  const creatorAddress = order.xrpl_address || order.xrplAddress;
  const counterpartyAddress = order.counterparty_address || order.counterpartyAddress;
  const sellerAddress = isSellOrder ? creatorAddress : counterpartyAddress;
  const buyerAddress = isSellOrder ? counterpartyAddress : creatorAddress;

  if (!sellerAddress || !buyerAddress) {
    throw new Error('Cannot determine trade parties for escrow verification');
  }

  if (callerAddress !== sellerAddress && callerAddress !== (order.escrow_owner || order.escrowOwner)) {
    const err = new Error('Only the seller (escrow owner) can submit the escrow hash');
    err.statusCode = 403;
    throw err;
  }

  if (['finished', 'refunded', 'cancelled'].includes(order.escrow_status)) {
    throw new Error(`Escrow already ${order.escrow_status}`);
  }

  if (!Number.isInteger(Number(offerSequence)) || Number(offerSequence) <= 0) {
    throw new Error('offerSequence must be a positive integer');
  }

  const expectedXrpAmount = Number(order.finalXrpAmount || order.final_xrp_amount
    || order.xrpAmount || order.amount_xrp);
  if (!Number.isFinite(expectedXrpAmount) || expectedXrpAmount <= 0) {
    throw new Error('Cannot determine expected XRP amount for escrow verification');
  }

  const expectedCondition = order.escrow_condition || order.escrowCondition;
  if (!expectedCondition) {
    throw new Error('No escrow condition recorded for this order — prepare escrow first');
  }

  const escrowOwner = order.escrow_owner || order.escrowOwner || sellerAddress;
  const verifyResult = await xrplVerificationService.verifyEscrowCreate(xrplClient, {
    hash: txHash,
    expectedOwner: escrowOwner,
    expectedDestination: buyerAddress,
    expectedAmountXrp: expectedXrpAmount,
    expectedCondition,
    expectedSequence: Number(offerSequence)
  });

  if (!verifyResult.verified) {
    throw new Error(`Escrow verification failed: ${verifyResult.reason}`);
  }

  return order;
}

/**
 * Cancel order
 */
function cancelOrder(order, reason) {
  if (order.status !== ORDER_STATUS.OPEN) {
    throw new Error(`Cannot cancel order in status: ${order.status}`);
  }

  transitionOrder(order, ORDER_STATUS.CANCELLED);
  order.cancelledAt = new Date().toISOString();
  order.cancelReason = reason;

  return order;
}

/**
 * Cancel a matched order (match dissolution), PRD 3.2.1.
 * Allowed only from `matched`, only when no TRY payment has been confirmed
 * and no escrow is locked on-chain. Once payment is confirmed or the escrow
 * is locked, the recourse path is a dispute, not a cancellation.
 */
function cancelMatchedOrder(order, reason) {
  if (order.status === ORDER_STATUS.PAYMENT_CONFIRMED) {
    throw new Error('Cannot cancel after payment is confirmed — open a dispute instead');
  }
  if (order.status !== ORDER_STATUS.MATCHED) {
    throw new Error(`Cannot cancel matched order in status: ${order.status}`);
  }

  const escrowStatus = order.escrowStatus || order.escrow_status;
  if (escrowStatus === xrplEscrowService.ESCROW_STATUS.LOCKED) {
    throw new Error('Cannot cancel while escrow is locked on-chain — open a dispute instead');
  }

  transitionOrder(order, ORDER_STATUS.CANCELLED);
  order.cancelledAt = new Date().toISOString();
  order.cancelReason = reason;

  return order;
}

/**
 * Confirm an escrow completion (finish or refund) on-chain.
 * Only callable while the escrow is in a pending state; verifies the
 * EscrowFinish/EscrowCancel transaction on the ledger before the caller
 * persists the terminal escrow status.
 *
 * @param {object} order
 * @param {string} txHash — 64-char hex EscrowFinish/EscrowCancel tx hash
 * @param {string} callerAddress — XRPL address of the authenticated caller
 * @param {object} xrplClient — connected XRPL Client instance
 * @returns {Promise<{order: object, escrowStatus: string}>}
 */
async function confirmEscrowCompletion(order, txHash, callerAddress, xrplClient) {
  if (!xrplClient) {
    throw new Error('XRPL client is required for on-chain verification');
  }

  const creatorAddress = order.xrpl_address || order.xrplAddress;
  const counterpartyAddress = order.counterparty_address || order.counterpartyAddress;
  if (callerAddress !== creatorAddress && callerAddress !== counterpartyAddress) {
    const err = new Error('Only trade participants can confirm escrow completion');
    err.statusCode = 403;
    throw err;
  }

  const escrowStatus = order.escrow_status || order.escrowStatus;
  const isFinish = escrowStatus === xrplEscrowService.ESCROW_STATUS.FINISH_PENDING;
  const isRefund = escrowStatus === xrplEscrowService.ESCROW_STATUS.REFUND_PENDING;
  if (!isFinish && !isRefund) {
    throw new Error(`Escrow is not pending completion (status: ${escrowStatus || 'none'})`);
  }

  const owner = order.escrow_owner || order.escrowOwner;
  const offerSequence = Number(order.escrow_sequence || order.escrowSequence);
  if (!owner) {
    throw new Error('Escrow owner is not recorded for this order');
  }
  if (!Number.isInteger(offerSequence) || offerSequence <= 0) {
    throw new Error('Escrow offer sequence is not recorded for this order');
  }

  const verifyResult = await xrplVerificationService.verifyEscrowCompletion(xrplClient, {
    hash: txHash,
    expectedType: isFinish ? 'EscrowFinish' : 'EscrowCancel',
    expectedOwner: owner,
    expectedOfferSequence: offerSequence
  });

  if (!verifyResult.verified) {
    throw new Error(`Escrow completion verification failed: ${verifyResult.reason}`);
  }

  return {
    order,
    escrowStatus: isFinish
      ? xrplEscrowService.ESCROW_STATUS.FINISHED
      : xrplEscrowService.ESCROW_STATUS.REFUNDED
  };
}

/**
 * Classify an expired locked escrow for the expiry sweep by checking the
 * ledger. The escrow is only considered cancelled when it is gone from the
 * ledger (already cancelled/finished on-chain); if it still exists on-chain
 * the sweep must not mark it cancelled.
 *
 * @param {object} order
 * @param {object} xrplClient — connected XRPL Client instance
 * @returns {Promise<'cancelled'|'cancel_pending'|'skip'>}
 */
async function classifyExpiredEscrow(order, xrplClient) {
  if (!xrplClient) {
    return 'skip';
  }

  const owner = order.escrow_owner || order.escrowOwner;
  if (!owner) {
    return 'skip'; // cannot query the ledger without an owner
  }

  const transactionHash = order.escrow_transaction_hash || order.escrowTransactionHash;
  const exists = await xrplVerificationService.escrowExistsOnLedger(xrplClient, {
    owner,
    transactionHash
  });

  if (exists === null) {
    return 'skip'; // ledger query failed; retry on the next sweep
  }
  return exists ? 'cancel_pending' : 'cancelled';
}

/**
 * Raise dispute
 */
function raiseDispute(order, reason, evidence) {
  if (![ORDER_STATUS.MATCHED, ORDER_STATUS.PAYMENT_CONFIRMED].includes(order.status)) {
    throw new Error(`Cannot raise dispute for order in status: ${order.status}`);
  }

  transitionOrder(order, ORDER_STATUS.DISPUTED);
  order.disputeReason = reason;
  order.disputeRaisedAt = new Date().toISOString();
  order.disputeEvidence = evidence;

  return order;
}

/**
 * Check if order is expired
 */
function isExpired(order) {
  if ([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED, ORDER_STATUS.DISPUTED].includes(order.status)) {
    return false;
  }

  normalizeOrder(order);
  if (!order.expiresAt) return false;
  return new Date(order.expiresAt) < new Date();
}

/**
 * Mark expired orders
 */
function markExpiredOrders(orders) {
  let expiredCount = 0;

  orders.forEach(order => {
    if (isExpired(order) && order.status === ORDER_STATUS.OPEN) {
      transitionOrder(order, ORDER_STATUS.EXPIRED);
      order.expiredAt = new Date().toISOString();
      expiredCount++;
    }
  });

  return expiredCount;
}

/**
 * Calculate order statistics
 */
function calculateOrderStats(orders) {
  const stats = {
    total: orders.length,
    open: 0,
    matched: 0,
    completed: 0,
    cancelled: 0,
    disputed: 0,
    avgCompletionTime: 0,
    totalVolumeTRY: 0,
    totalVolumeXRP: 0,
    avgRate: 0,
    buyOrders: 0,
    sellOrders: 0
  };

  let completionTimes = [];
  let rates = [];

  orders.forEach(order => {
    // Count by status
    if (order.status === ORDER_STATUS.OPEN) stats.open++;
    if (order.status === ORDER_STATUS.MATCHED) stats.matched++;
    if (order.status === ORDER_STATUS.COMPLETED) stats.completed++;
    if (order.status === ORDER_STATUS.CANCELLED) stats.cancelled++;
    if (order.status === ORDER_STATUS.DISPUTED) stats.disputed++;

    // Count by type
    if (order.type === ORDER_TYPE.BUY) stats.buyOrders++;
    if (order.type === ORDER_TYPE.SELL) stats.sellOrders++;

    // Calculate volumes
    if (order.status === ORDER_STATUS.COMPLETED) {
      stats.totalVolumeTRY += order.finalTryAmount || order.tryAmount;
      stats.totalVolumeXRP += order.finalXrpAmount || order.xrpAmount;
      rates.push(order.finalRate || order.rate);

      // Calculate completion time
      if (order.createdAt && order.completedAt) {
        const time = new Date(order.completedAt) - new Date(order.createdAt);
        completionTimes.push(time);
      }
    }
  });

  // Calculate averages
  if (completionTimes.length > 0) {
    stats.avgCompletionTime = Math.round(
      completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length / 1000 / 60
    ); // in minutes
  }

  if (rates.length > 0) {
    stats.avgRate = Math.round(
      (rates.reduce((a, b) => a + b, 0) / rates.length) * 100
    ) / 100;
  }

  return stats;
}

/**
 * Get order summary for display
 */
function getOrderSummary(order) {
  return {
    id: order.order_id || order.id,
    type: order.type || order.order_type,
    status: order.status,
    tryAmount: order.tryAmount ?? order.amount_try,
    xrpAmount: order.xrpAmount ?? order.amount_xrp,
    rate: order.rate,
    paymentMethods: order.paymentMethods || order.payment_methods,
    createdAt: order.createdAt || order.created_at,
    expiresAt: order.expiresAt || order.expires_at,
    isExpired: isExpired(order),
    rating: order.rating,
    completedTrades: order.completedTrades,
    matchedOrderId: order.matchedOrderId !== undefined ? order.matchedOrderId : (order.counterparty_order_id ?? null),
    counterpartyAddress: order.counterpartyAddress !== undefined ? order.counterpartyAddress : (order.counterparty_address ?? null),
    escrowStatus: order.escrowStatus || order.escrow_status || 'none',
    notes: order.metadata ? order.metadata.notes : undefined
  };
}

/**
 * Initialize Papara service instance
 */
let paparaService = null;
function getPaparaService() {
  if (!paparaService) {
    paparaService = new PaparaService();
  }
  return paparaService;
}

/**
 * Confirm TRY payment with Papara validation
 */
async function confirmPayment(order, proofOfPayment, paparaAccountNumber = null) {
  if (order.status !== ORDER_STATUS.MATCHED) {
    throw new Error(`Cannot confirm payment for order in status: ${order.status}`);
  }

  // If payment method is Papara, validate account before confirming
  if (order.counterpartyPaymentMethod === PAYMENT_METHODS.PAPARA) {
    if (!paparaAccountNumber) {
      throw new Error('Papara account number is required for Papara payments');
    }

    try {
      const paparaService = getPaparaService();
      const validation = await paparaService.validateAccount(paparaAccountNumber);
      
      if (!validation.success || !validation.accountExists) {
        throw new Error('Invalid Papara account number');
      }

      // Store Papara account information in order metadata
      order.metadata = order.metadata || {};
      order.metadata.paparaAccountNumber = paparaAccountNumber;
      order.metadata.paparaAccountHolder = validation.accountHolder;
      order.metadata.paparaValidatedAt = new Date().toISOString();
    } catch (error) {
      throw new Error(`Papara account validation failed: ${error.message}`);
    }
  }

  transitionOrder(order, ORDER_STATUS.PAYMENT_CONFIRMED);
  order.paymentConfirmedAt = new Date().toISOString();
  order.proofOfPayment = proofOfPayment;

  return order;
}

/**
 * Process Papara instant transfer payment
 */
async function processPaparaPayment(order, paparaAccountNumber) {
  try {
    logger.logP2P('papara_payment_requested', {
      orderId: order.order_id,
      paparaAccountNumber: maskAccountNumber(paparaAccountNumber)
    });

    // This function will be called from the API endpoint
    // It should get the order from database and process the payment
    const paparaService = getPaparaService();

    // Validate the Papara account first
    const validation = await paparaService.validateAccount(paparaAccountNumber);

    if (!validation.success || !validation.accountExists) {
      throw new Error('Invalid Papara account number');
    }

    // Create payment description
    const description = `P2P XRP Exchange - Order ${order.order_id}`;

    // Send instant transfer
    const paymentResult = await paparaService.sendPayment(
      order.amount_try,
      paparaAccountNumber,
      description,
      {
        orderId: order.order_id,
        counterpartyAddress: order.counterparty_address,
        xrpAmount: order.amount_xrp
      }
    );

    if (!paymentResult.success) {
      throw new Error('Papara payment creation failed');
    }

    // Persist the referenceId → order mapping so the HMAC-verified webhook
    // can resolve the order (and provide replay protection).
    await PaparaPaymentsDAL.create({
      referenceId: paymentResult.referenceId,
      orderId: order.order_id,
      transactionId: paymentResult.transactionId || null,
      amountTry: order.amount_try
    });

    logger.logP2P('papara_payment_initiated', {
      orderId: order.order_id,
      transactionId: paymentResult.transactionId,
      referenceId: paymentResult.referenceId
    });

    return {
      success: true,
      transactionId: paymentResult.transactionId,
      referenceId: paymentResult.referenceId,
      status: paymentResult.status,
      paymentUrl: paymentResult.paymentUrl,
      amount: paymentResult.amount,
      fee: paymentResult.fee,
      message: 'Papara payment initiated successfully'
    };

  } catch (error) {
    logger.error('Papara payment processing error', {
      orderId: order && order.order_id,
      error: error.message
    });
    throw new Error(`Papara payment failed: ${error.message}`);
  }
}

/**
 * Get Papara payment status
 */
async function getPaparaPaymentStatus(transactionId) {
  try {
    const paparaService = getPaparaService();
    const statusResult = await paparaService.getPaymentStatus(transactionId);
    
    if (!statusResult.success) {
      throw new Error('Failed to get payment status');
    }

    return {
      success: true,
      transactionId: statusResult.transactionId,
      status: statusResult.status,
      statusDescription: statusResult.statusDescription,
      amount: statusResult.amount,
      fee: statusResult.fee,
      createdAt: statusResult.createdAt,
      paymentMethod: statusResult.paymentMethod,
      paymentMethodDescription: statusResult.paymentMethodDescription
    };

  } catch (error) {
    logger.error('Papara payment status check error', { transactionId, error: error.message });
    throw new Error(`Payment status check failed: ${error.message}`);
  }
}

/**
 * Get Papara account balance
 */
async function getPaparaBalance() {
  try {
    const paparaService = getPaparaService();
    const balanceResult = await paparaService.getAccountBalance();
    
    if (!balanceResult.success) {
      throw new Error('Failed to get account balance');
    }

    return {
      success: true,
      balance: balanceResult.balance,
      currency: balanceResult.currency,
      accountNumber: balanceResult.accountNumber,
      merchantId: balanceResult.merchantId
    };

  } catch (error) {
    logger.error('Papara balance check error', { error: error.message });
    throw new Error(`Balance check failed: ${error.message}`);
  }
}

module.exports = {
  ORDER_TYPE,
  ORDER_STATUS,
  ORDER_TRANSITIONS,
  PAYMENT_METHODS,
  canTransition,
  transitionOrder,
  createP2POrder,
  findMatchingOrders,
  matchOrders,
  confirmPayment,
  confirmXrpTransfer,
  lockEscrowForOrder,
  confirmEscrowCompletion,
  classifyExpiredEscrow,
  cancelOrder,
  cancelMatchedOrder,
  raiseDispute,
  isExpired,
  markExpiredOrders,
  calculateOrderStats,
  getOrderSummary,
  normalizeOrder,
  // Papara integration functions
  processPaparaPayment,
  getPaparaPaymentStatus,
  getPaparaBalance,
  getPaparaService
};
