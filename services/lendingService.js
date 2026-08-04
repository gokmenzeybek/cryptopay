/**
 * Lending Marketplace Service (platform as XRP reserve)
 *
 * The platform lends XRP to sellers by funding escrows from its reserve
 * directly to the buyer (the lend never touches the seller's wallet). TRY
 * clears buyer -> platform, the platform keeps a 2.5% cut on TRY (the only cut
 * basis), and the seller is paid net TRY. See docs/LENDING_MARKETPLACE.md.
 *
 * The reserve path is OPT-IN: unless RESERVE_ADDRESS is configured the helper
 * functions fall back to the legacy seller-sourced escrow and record no cut,
 * so production is unchanged until it is enabled (mirrors the SPONSOR_SEED /
 * lazy-Redis pattern).
 */

const { pool } = require('../database/connection');
const logger = require('../utils/logger');

// Platform cut on TRY — the only cut basis (decimal, e.g. 0.025 = 2.5%).
const DEFAULT_CUT_PERCENT = 0.025;

/**
 * Effective platform cut rate.
 * @returns {number}
 */
function cutPercent() {
  const raw = parseFloat(process.env.RESERVE_CUT_PERCENT);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CUT_PERCENT;
}

/**
 * Configured reserve (XRP reserve/lender) classic address, or null when the
 * reserve path is disabled.
 * @returns {string|null}
 */
function reserveAddress() {
  const addr = (process.env.RESERVE_ADDRESS || '').trim();
  return addr || null;
}

/**
 * Whether the reserve-backed (platform-lend) path is active.
 * @returns {boolean}
 */
function reserveEnabled() {
  return Boolean(reserveAddress());
}

/** Round a TRY value to 2 decimal places. */
function roundTry(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Compute the platform cut on a TRY trade.
 *
 * @param {number} tryAmount — gross TRY the buyer paid to the platform
 * @returns {{grossTry:number, cutTry:number, sellerPayoutTry:number, cutPercent:number}}
 */
function computeCut(tryAmount) {
  const grossTry = roundTry(tryAmount);
  const cutTry = roundTry(grossTry * cutPercent());
  const sellerPayoutTry = roundTry(grossTry - cutTry);
  return { grossTry, cutTry, sellerPayoutTry, cutPercent: cutPercent() };
}

/**
 * Determine who escrow-funds (lends) the XRP for a trade.
 *
 * When the reserve path is enabled the reserve escrows XRP directly to the
 * buyer (the platforms's lend); otherwise the seller funds it as today.
 *
 * @param {object} order — p2p order row
 * @param {boolean} [allowReserve=true]
 * @returns {string} the classic address that should be the EscrowCreate Account
 */
function escrowSource(order, { allowReserve = true } = {}) {
  if (allowReserve && reserveEnabled()) {
    return reserveAddress();
  }
  const orderType = order.order_type || order.type;
  const creator = order.xrpl_address || order.xrplAddress;
  const counterparty = order.counterparty_address || order.counterpartyAddress;
  return orderType === 'sell' ? creator : counterparty;
}

/**
 * Fetch a seller's current reserve credit line.
 * @returns {{credit_limit_xrp:string, outstanding_xrp:string, available_xrp:string}}
 */
async function getCredit(sellerAddress) {
  const result = await pool.query(
    'SELECT credit_limit_xrp, outstanding_xrp FROM reserve_credit WHERE seller_address = $1',
    [sellerAddress]
  );
  const row = result.rows[0];
  if (!row) {
    return { credit_limit_xrp: '0', outstanding_xrp: '0', available_xrp: '0' };
  }
  const available = Number(row.credit_limit_xrp) - Number(row.outstanding_xrp);
  return {
    credit_limit_xrp: row.credit_limit_xrp,
    outstanding_xrp: row.outstanding_xrp,
    available_xrp: String(available > 0 ? available : 0)
  };
}

/**
 * Check a seller may lend (reserve-backed) a given XRP amount; throws if their
 * quota is exhausted. Does not mutate state.
 */
async function authorizeLend(sellerAddress, xrpAmount) {
  if (!xrpAmount || Number(xrpAmount) <= 0) {
    throw new Error('xrpAmount must be a positive number');
  }
  const credit = await getCredit(sellerAddress);
  const limit = Number(credit.credit_limit_xrp || 0);
  const outstanding = Number(credit.outstanding_xrp || 0);
  const amount = Number(xrpAmount);
  if (outstanding + amount > limit) {
    throw new Error(
      `Seller reserve credit exhausted: ${outstanding + amount} of ${limit} XRP`
    );
  }
  return { limitXrp: limit, outstandingXrp: outstanding, approved: true };
}

/**
 * Escalate a lend: bump the seller's outstanding reserve balance.
 * Must be preceded by authorizeLend.
 */
async function reserveLend(sellerAddress, xrpAmount) {
  await pool.query(
    `INSERT INTO reserve_credit (seller_address, credit_limit_xrp, outstanding_xrp)
     VALUES ($1, 0, $2)
     ON CONFLICT (seller_address)
     DO UPDATE SET outstanding_xrp = reserve_credit.outstanding_xrp + EXCLUDED.outstanding_xrp,
                   updated_at = NOW()`,
    [sellerAddress, Number(xrpAmount)]
  );
}

/**
 * Release a lend back to the reserve when a trade settles (or is voided).
 */
async function releaseLend(sellerAddress, xrpAmount) {
  await pool.query(
    `UPDATE reserve_credit
        SET outstanding_xrp = GREATEST(outstanding_xrp - $2, 0),
            updated_at = NOW()
      WHERE seller_address = $1`,
    [sellerAddress, Number(xrpAmount)]
  );
}

/**
 * Record a settlement (cut + payout) and reconcile the lend.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.sellerAddress
 * @param {number} params.grossTry — buyer TRY cleared through the platform
 * @param {number} params.lentXrp — XRP lent by the reserve for this trade
 * @returns {Promise<object>} the new reserve_settlements row
 */
async function recordSettlement({ orderId, sellerAddress, grossTry, lentXrp }) {
  const { cutTry, sellerPayoutTry, cutPercent: pct } = computeCut(grossTry);

  const result = await pool.query(
    `INSERT INTO reserve_settlements
       (order_id, seller_address, gross_try, cut_try, cut_percent, lent_xrp, seller_payout_try, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING *`,
    [orderId, sellerAddress, grossTry, cutTry, pct, Number(lentXrp) || 0, sellerPayoutTry]
  );

  await releaseLend(sellerAddress, Number(lentXrp) || 0);

  logger.logP2P('reserve_settlement_recorded', {
    orderId,
    grossTry,
    cutTry,
    sellerPayoutTry
  });

  return result.rows[0];
}

/**
 * Mark a settlement paid out (idempotent).
 */
async function markSettlementPaid(settlementId) {
  const result = await pool.query(
    `UPDATE reserve_settlements
        SET status = 'paid', paid_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [settlementId]
  );
  return result.rows[0] || null;
}

/**
 * Void a settlement (e.g. cancelled / no-show trade). Returns the lend to the
 * reserve when a lent amount is provided.
 */
async function voidSettlement({ orderId, sellerAddress, lentXrp }) {
  await pool.query(
    `UPDATE reserve_settlements
        SET status = 'void'
      WHERE order_id = $1 AND status = 'pending'`,
    [orderId]
  );
  if (Number(lentXrp) > 0) {
    await releaseLend(sellerAddress, Number(lentXrp));
  }
}

module.exports = {
  DEFAULT_CUT_PERCENT,
  cutPercent,
  reserveAddress,
  reserveEnabled,
  computeCut,
  escrowSource,
  getCredit,
  authorizeLend,
  reserveLend,
  releaseLend,
  recordSettlement,
  markSettlementPaid,
  voidSettlement
};