/**
 * XRPL On-Chain Verification Service
 *
 * Verifies XRPL transactions by fetching them directly from the ledger.
 * All verification functions return a result object rather than throwing,
 * so callers can distinguish "not verified" from "unexpected error".
 */

const logger = require('../utils/logger');

// XRP has 6 decimal places: 1 XRP = 1,000,000 drops
const DROPS_PER_XRP = 1000000;

/**
 * Convert a drops string to a float XRP amount.
 * @param {string} drops
 * @returns {number}
 */
function dropsToXrp(drops) {
  return Number(drops) / DROPS_PER_XRP;
}

/**
 * Extract the delivered XRP amount (in XRP) from a payment transaction result.
 * Prefers meta.delivered_amount when available and numeric; falls back to Amount.
 * @param {object} result — the `result` field of an XRPL tx response
 * @returns {{ amountXrp: number, source: string }|null}
 */
function extractDeliveredXrp(result) {
  const delivered = result.meta && result.meta.delivered_amount;
  if (typeof delivered === 'string' && /^[0-9]+$/.test(delivered)) {
    return { amountXrp: dropsToXrp(delivered), source: 'delivered_amount' };
  }
  const amount = result.Amount;
  if (typeof amount === 'string' && /^[0-9]+$/.test(amount)) {
    return { amountXrp: dropsToXrp(amount), source: 'Amount' };
  }
  return null;
}

/**
 * Verify a Payment transaction on the XRPL ledger.
 *
 * @param {object} client — an XRPL Client instance with an active connection
 * @param {object} params
 * @param {string} params.hash — 64-character hex transaction hash
 * @param {string} params.expectedDestination — the XRPL address that must receive the payment
 * @param {number} params.minAmountXrp — minimum XRP amount required (inclusive)
 * @returns {Promise<{verified: boolean, reason?: string}>}
 */
async function verifyPayment(client, { hash, expectedDestination, minAmountXrp }) {
  try {
    if (!hash || typeof hash !== 'string') {
      return { verified: false, reason: 'Transaction hash is required' };
    }
    if (!expectedDestination || typeof expectedDestination !== 'string') {
      return { verified: false, reason: 'Expected destination is required' };
    }
    if (!Number.isFinite(minAmountXrp) || minAmountXrp <= 0) {
      return { verified: false, reason: 'minAmountXrp must be a positive number' };
    }

    const response = await client.request({ command: 'tx', transaction: hash });
    const result = response && response.result;

    if (!result) {
      return { verified: false, reason: 'Transaction not found on ledger' };
    }

    if (result.validated !== true) {
      return { verified: false, reason: 'Transaction is not yet validated' };
    }

    const txResult = result.meta && result.meta.TransactionResult;
    if (txResult !== 'tesSUCCESS') {
      return { verified: false, reason: `Transaction failed with result: ${txResult}` };
    }

    if (result.TransactionType !== 'Payment') {
      return { verified: false, reason: `Expected Payment, got ${result.TransactionType}` };
    }

    if (result.Destination !== expectedDestination) {
      return {
        verified: false,
        reason: `Destination mismatch: expected ${expectedDestination}, got ${result.Destination}`
      };
    }

    const delivered = extractDeliveredXrp(result);
    if (!delivered) {
      return { verified: false, reason: 'Could not determine delivered XRP amount' };
    }

    if (delivered.amountXrp < minAmountXrp) {
      return {
        verified: false,
        reason: `Amount insufficient: expected at least ${minAmountXrp} XRP, got ${delivered.amountXrp} XRP`
      };
    }

    logger.logXRPL('payment_verified', {
      hash,
      destination: expectedDestination,
      amountXrp: delivered.amountXrp,
      source: delivered.source
    });

    return { verified: true };
  } catch (err) {
    // Distinguish "txn not found" (Rippled returns an error object) from
    // genuine runtime errors.
    const rippledError = err && err.data && err.data.error;
    if (rippledError === 'txnNotFound') {
      return { verified: false, reason: 'Transaction not found on ledger' };
    }
    logger.error('verifyPayment unexpected error', { hash, error: err.message });
    return { verified: false, reason: `Verification error: ${err.message}` };
  }
}

/**
 * Verify an EscrowCreate transaction on the XRPL ledger.
 *
 * @param {object} client — an XRPL Client instance with an active connection
 * @param {object} params
 * @param {string} params.hash — 64-character hex transaction hash
 * @param {string} params.expectedOwner — the Account that created the escrow
 * @param {string} params.expectedDestination — the Destination of the escrow
 * @param {number} params.expectedAmountXrp — the exact XRP amount expected
 * @param {string} params.expectedCondition — the 64-character hex condition
 * @param {number} [params.expectedSequence] — the escrow's Sequence (offer sequence) on the owner account
 * @returns {Promise<{verified: boolean, reason?: string}>}
 */
async function verifyEscrowCreate(client, {
  hash,
  expectedOwner,
  expectedDestination,
  expectedAmountXrp,
  expectedCondition,
  expectedSequence
}) {
  try {
    if (!hash || typeof hash !== 'string') {
      return { verified: false, reason: 'Transaction hash is required' };
    }
    if (!expectedOwner || typeof expectedOwner !== 'string') {
      return { verified: false, reason: 'Expected owner is required' };
    }
    if (!expectedDestination || typeof expectedDestination !== 'string') {
      return { verified: false, reason: 'Expected destination is required' };
    }
    if (!Number.isFinite(expectedAmountXrp) || expectedAmountXrp <= 0) {
      return { verified: false, reason: 'expectedAmountXrp must be a positive number' };
    }
    if (!expectedCondition || typeof expectedCondition !== 'string') {
      return { verified: false, reason: 'Expected condition is required' };
    }

    const response = await client.request({ command: 'tx', transaction: hash });
    const result = response && response.result;

    if (!result) {
      return { verified: false, reason: 'Transaction not found on ledger' };
    }

    if (result.validated !== true) {
      return { verified: false, reason: 'Transaction is not yet validated' };
    }

    const txResult = result.meta && result.meta.TransactionResult;
    if (txResult !== 'tesSUCCESS') {
      return { verified: false, reason: `Transaction failed with result: ${txResult}` };
    }

    if (result.TransactionType !== 'EscrowCreate') {
      return { verified: false, reason: `Expected EscrowCreate, got ${result.TransactionType}` };
    }

    if (result.Account !== expectedOwner) {
      return {
        verified: false,
        reason: `Owner mismatch: expected ${expectedOwner}, got ${result.Account}`
      };
    }

    if (result.Destination !== expectedDestination) {
      return {
        verified: false,
        reason: `Destination mismatch: expected ${expectedDestination}, got ${result.Destination}`
      };
    }

    const amount = extractDeliveredXrp(result);
    if (!amount) {
      return { verified: false, reason: 'Could not determine escrowed XRP amount' };
    }

    // Use a small epsilon for float comparison since drops → XRP can introduce rounding
    const epsilon = 0.000001;
    if (Math.abs(amount.amountXrp - expectedAmountXrp) > epsilon) {
      return {
        verified: false,
        reason: `Amount mismatch: expected ${expectedAmountXrp} XRP, got ${amount.amountXrp} XRP`
      };
    }

    if (result.Condition !== expectedCondition) {
      return {
        verified: false,
        reason: `Condition mismatch: expected ${expectedCondition}, got ${result.Condition}`
      };
    }

    if (expectedSequence !== undefined && expectedSequence !== null
      && Number(result.Sequence) !== Number(expectedSequence)) {
      return {
        verified: false,
        reason: `Sequence mismatch: expected ${expectedSequence}, got ${result.Sequence}`
      };
    }

    logger.logXRPL('escrow_create_verified', {
      hash,
      owner: expectedOwner,
      destination: expectedDestination,
      amountXrp: amount.amountXrp
    });

    return { verified: true };
  } catch (err) {
    const rippledError = err && err.data && err.data.error;
    if (rippledError === 'txnNotFound') {
      return { verified: false, reason: 'Transaction not found on ledger' };
    }
    logger.error('verifyEscrowCreate unexpected error', { hash, error: err.message });
    return { verified: false, reason: `Verification error: ${err.message}` };
  }
}

/**
 * Verify an EscrowFinish or EscrowCancel transaction on the XRPL ledger.
 * The submitter (Account) is intentionally NOT restricted: anyone may finish
 * an escrow with the correct fulfillment, or cancel an expired escrow.
 *
 * @param {object} client — an XRPL Client instance with an active connection
 * @param {object} params
 * @param {string} params.hash — 64-character hex transaction hash
 * @param {string} params.expectedType — 'EscrowFinish' or 'EscrowCancel'
 * @param {string} params.expectedOwner — the Owner (escrow creator account)
 * @param {number} params.expectedOfferSequence — the escrow's Sequence on the owner account
 * @returns {Promise<{verified: boolean, reason?: string}>}
 */
async function verifyEscrowCompletion(client, {
  hash,
  expectedType,
  expectedOwner,
  expectedOfferSequence
}) {
  try {
    if (!hash || typeof hash !== 'string') {
      return { verified: false, reason: 'Transaction hash is required' };
    }
    if (!['EscrowFinish', 'EscrowCancel'].includes(expectedType)) {
      return { verified: false, reason: `Unsupported escrow completion type: ${expectedType}` };
    }
    if (!expectedOwner || typeof expectedOwner !== 'string') {
      return { verified: false, reason: 'Expected owner is required' };
    }
    if (!Number.isInteger(Number(expectedOfferSequence)) || Number(expectedOfferSequence) <= 0) {
      return { verified: false, reason: 'expectedOfferSequence must be a positive integer' };
    }

    const response = await client.request({ command: 'tx', transaction: hash });
    const result = response && response.result;

    if (!result) {
      return { verified: false, reason: 'Transaction not found on ledger' };
    }

    if (result.validated !== true) {
      return { verified: false, reason: 'Transaction is not yet validated' };
    }

    const txResult = result.meta && result.meta.TransactionResult;
    if (txResult !== 'tesSUCCESS') {
      return { verified: false, reason: `Transaction failed with result: ${txResult}` };
    }

    if (result.TransactionType !== expectedType) {
      return { verified: false, reason: `Expected ${expectedType}, got ${result.TransactionType}` };
    }

    if (result.Owner !== expectedOwner) {
      return {
        verified: false,
        reason: `Owner mismatch: expected ${expectedOwner}, got ${result.Owner}`
      };
    }

    if (Number(result.OfferSequence) !== Number(expectedOfferSequence)) {
      return {
        verified: false,
        reason: `OfferSequence mismatch: expected ${expectedOfferSequence}, got ${result.OfferSequence}`
      };
    }

    logger.logXRPL('escrow_completion_verified', {
      hash,
      type: expectedType,
      owner: expectedOwner,
      offerSequence: Number(expectedOfferSequence)
    });

    return { verified: true };
  } catch (err) {
    const rippledError = err && err.data && err.data.error;
    if (rippledError === 'txnNotFound') {
      return { verified: false, reason: 'Transaction not found on ledger' };
    }
    logger.error('verifyEscrowCompletion unexpected error', { hash, error: err.message });
    return { verified: false, reason: `Verification error: ${err.message}` };
  }
}

/**
 * Check whether an escrow object still exists on the XRPL ledger.
 * Returns true/false, or null when the ledger could not be queried
 * (caller should treat null as "unknown — try again later", never as absent).
 *
 * @param {object} client — an XRPL Client instance with an active connection
 * @param {object} params
 * @param {string} params.owner — the escrow owner account
 * @param {string} [params.transactionHash] — the EscrowCreate hash; when given,
 *   matches escrow objects by PreviousTxnID, otherwise any escrow of the owner counts
 * @returns {Promise<boolean|null>}
 */
async function escrowExistsOnLedger(client, { owner, transactionHash }) {
  try {
    if (!owner || typeof owner !== 'string') {
      return null;
    }

    const response = await client.request({
      command: 'account_objects',
      account: owner,
      type: 'escrow',
      ledger_index: 'validated'
    });
    const objects = (response && response.result && response.result.account_objects) || [];

    if (transactionHash) {
      return objects.some((obj) => obj.PreviousTxnID === transactionHash);
    }
    return objects.length > 0;
  } catch (err) {
    logger.error('escrowExistsOnLedger query failed', { owner, error: err.message });
    return null;
  }
}

/**
 * Verify a payment via XRPL subscription (real-time) with polling fallback.
 * Waits for the transaction to appear on-chain via WebSocket subscription,
 * then falls back to polling if the subscription times out.
 * @param {xrpl.Client} client - XRPL client
 * @param {Object} params - { hash, expectedDestination, minAmountXrp }
 * @param {number} [timeout=30000] - Subscription timeout in ms
 * @returns {Promise<{ verified: boolean, reason?: string, tx?: Object }>}
 */
async function verifyPaymentViaSubscription(client, params, timeout = 30000) {
  const { trackTransaction } = require('./xrplSubscriptionService');

  try {
    const result = await trackTransaction(params.hash, { timeout });

    if (result.result !== 'tesSUCCESS') {
      return { verified: false, reason: `Transaction failed: ${result.result}`, tx: result };
    }

    if (params.expectedDestination && result.destination !== params.expectedDestination) {
      return { verified: false, reason: 'Destination mismatch', tx: result };
    }

    return { verified: true, tx: result };
  } catch (err) {
    logger.warn('Subscription verification timed out, falling back to polling', { hash: params.hash });
    return verifyPayment(client, params);
  }
}

module.exports = {
  verifyPayment,
  verifyPaymentViaSubscription,
  verifyEscrowCreate,
  verifyEscrowCompletion,
  escrowExistsOnLedger,
  // Exposed for unit testing
  _dropsToXrp: dropsToXrp,
  _extractDeliveredXrp: extractDeliveredXrp
};
