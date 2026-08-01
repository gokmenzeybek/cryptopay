/**
 * Burner Wallet Service (two-tier users)
 *
 * Guest buyers get a fresh, zero-spendable-XRP burner wallet per transaction
 * instead of the faucet-funded persistent wallet sellers use. The platform
 * sponsors exactly the base reserve so the address exists on-ledger (required
 * for EscrowFinish — EscrowCreate/Finish to an unfunded address fails with
 * tecNO_DST). After the session, a sweeper destroys the account with
 * AccountDelete, sweeping the residual balance back to the sponsor and burning
 * the 0.2 XRP owner-reserve fee.
 *
 * Seed custody: the server NEVER persists burner seeds. They live in an
 * in-memory Map (TTL'd) so the sweeper can still sign the AccountDelete.
 * This is a deliberate, documented deviation from "server never holds seeds",
 * limited to zero-value throwaway accounts.
 */

const xrpl = require('xrpl');
const jwt = require('jsonwebtoken');
const { pool } = require('../database/connection');
const { WalletsDAL, SystemSettingsDAL } = require('../database/dal');
const logger = require('../utils/logger');

// XRP has 6 decimal places: 1 XRP = 1,000,000 drops
const DROPS_PER_XRP = 1000000;

// Order statuses after which a burner's purchased XRP has been delivered or
// the trade abandoned — safe to destroy the account.
const TERMINAL_ORDER_STATUSES = ['completed', 'cancelled', 'expired'];

const SEED_TTL_MS = parseInt(process.env.BURNER_SEED_TTL_MS, 10) || 60 * 60 * 1000;

async function getBurnerSettings() {
  try {
    const settings = await SystemSettingsDAL.getAll();
    return {
      sponsorSeed: settings.sponsor_seed || process.env.SPONSOR_SEED,
      sponsorAddress: settings.sponsor_address || process.env.SPONSOR_ADDRESS,
      sweepIntervalMs: parseInt(settings.burner_sweep_interval_ms, 10) || parseInt(process.env.BURNER_SWEEP_INTERVAL_MS, 10) || 60000,
      destroyDelayMs: parseInt(settings.burner_destroy_delay_ms, 10) || parseInt(process.env.BURNER_DESTROY_DELAY_MS, 10) || 16 * 60 * 1000
    };
  } catch (err) {
    if (!process.env.SPONSOR_SEED) {
      throw err;
    }
    return {
      sponsorSeed: process.env.SPONSOR_SEED,
      sponsorAddress: process.env.SPONSOR_ADDRESS,
      sweepIntervalMs: parseInt(process.env.BURNER_SWEEP_INTERVAL_MS, 10) || 60000,
      destroyDelayMs: parseInt(process.env.BURNER_DESTROY_DELAY_MS, 10) || 16 * 60 * 1000
    };
  }
}

const xrplUrl = () => process.env.XRPL_TESTNET_URL || 'wss://s.altnet.rippletest.net:51233';

/**
 * Poll the ledger until the transaction is validated.
 */
async function waitForValidation(client, txHash, { maxAttempts = 15, delayMs = 1000 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await client.request({ command: 'tx', transaction: txHash });
      if (res.result && res.result.validated) {
        return res.result;
      }
    } catch (err) {
      // The tx may not have propagated yet — keep polling; rethrow anything
      // that isn't txnNotFound.
      const notFound = err && err.data && err.data.error === 'txnNotFound';
      if (!notFound) {
        throw err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('Transaction not validated in time');
}

class BurnerWalletService {
  constructor() {
    // address -> { seed, expiresAt }  (never persisted, TTL'd)
    this.seeds = new Map();
    this.sweepTimer = null;
  }

  /**
   * Register a burner seed in memory with a TTL. Expired entries are lazily
   * evicted on read.
   */
  _rememberSeed(address, seed) {
    this.seeds.set(address, { seed, expiresAt: Date.now() + SEED_TTL_MS });
  }

  /**
   * Fetch a burner's seed if it is still held in memory and not expired.
   */
  _seedFor(address) {
    const entry = this.seeds.get(address);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.seeds.delete(address);
      return null;
    }
    return entry.seed;
  }

  _dropSeed(address) {
    this.seeds.delete(address);
  }

  /**
   * Read the current base reserve from the ledger (drops) — never hardcoded,
   * because it can change.
   */
  async getReserveBase(client) {
    const serverState = await client.request({ command: 'server_state' });
    const state = serverState && serverState.result && serverState.result.state;
    const reserveBase = state && state.validated_ledger && state.validated_ledger.reserve_base;
    if (!reserveBase) {
      throw new Error('Could not read reserve_base from server_state');
    }
    return reserveBase;
  }

  /**
   * Sponsor Payment of exactly the base reserve to a fresh burner address.
   */
  async _fundBurner(client, sponsor, destinationAddress) {
    const reserveBaseDrops = await this.getReserveBase(client);
    const payment = await client.autofill({
      TransactionType: 'Payment',
      Account: sponsor.classicAddress,
      Destination: destinationAddress,
      Amount: String(reserveBaseDrops)
    });
    const signed = sponsor.sign(payment);
    const prelim = await client.submit(signed.tx_blob);
    if (prelim.result && prelim.result.engine_result !== 'tesSUCCESS') {
      throw new Error(`Sponsor payment failed: ${prelim.result.engine_result}`);
    }
    await waitForValidation(client, signed.hash);
    return {
      reserveDrops: reserveBaseDrops,
      reserveXrp: reserveBaseDrops / DROPS_PER_XRP
    };
  }

  /**
   * Create a fresh burner wallet for a guest buyer:
   *   1. generate a zero-balance keypair (no faucet),
   *   2. sponsor exactly the base reserve so it exists on-ledger,
   *   3. hold the seed in-memory only,
   *   4. record lifecycle metadata + upsert the wallets row (role 'buyer'),
   *   5. issue a short-lived JWT so the guest session is authenticated.
   *
   * @returns {Promise<{address, seed, reserveXrp, token}>}
   */
  async createBurner() {
    const cfg = await getBurnerSettings();

    if (!cfg.sponsorSeed) {
      throw new Error('SPONSOR_SEED is not configured — burner wallets are unavailable');
    }

    const wallet = xrpl.Wallet.generate();
    const sponsor = xrpl.Wallet.fromSeed(cfg.sponsorSeed);
    if (cfg.sponsorAddress && sponsor.classicAddress !== cfg.sponsorAddress) {
      throw new Error('SPONSOR_ADDRESS does not match the derived address of SPONSOR_SEED');
    }

    let client = null;
    try {
      client = new xrpl.Client(xrplUrl());
      await client.connect();

      const { reserveDrops, reserveXrp } = await this._fundBurner(client, sponsor, wallet.address);

      this._rememberSeed(wallet.address, wallet.seed);

      await pool.query(
        `INSERT INTO burner_wallets (address, status)
         VALUES ($1, 'active')
         ON CONFLICT (address) DO UPDATE SET status = 'active', deleted_at = NULL`,
        [wallet.address]
      );

      await WalletsDAL.create({
        address: wallet.address,
        public_key: wallet.publicKey,
        is_active: true,
        role: 'buyer'
      });

      const token = jwt.sign(
        { address: wallet.address, role: 'buyer', burner: true },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
      );

      logger.logP2P('burner_wallet_created', { address: wallet.address, reserveXrp });

      return {
        address: wallet.address,
        seed: wallet.seed,
        reserveXrp,
        token
      };
    } catch (err) {
      logger.error('Failed to create burner wallet', { error: err.message });
      throw err;
    } finally {
      if (client) {
        try { await client.disconnect(); } catch (_) { /* already closed */ }
      }
    }
  }

  /**
   * Fetch a burner's metadata row.
   */
  async getBurner(address) {
    const result = await pool.query(
      'SELECT address, order_id, status, funded_at, created_at, deleted_at FROM burner_wallets WHERE address = $1',
      [address]
    );
    return result.rows[0] || null;
  }

  /**
   * Record that a burner's trade has settled, marking it sweep_pending.
   */
  async markOrderSettled(address, orderId) {
    const result = await pool.query(
      `UPDATE burner_wallets
       SET order_id = $2, status = 'sweep_pending'
       WHERE address = $1
       RETURNING address, order_id, status`,
      [address, orderId]
    );
    return result.rows[0] || null;
  }

  /**
   * Destroy a burner on-ledger with AccountDelete:
   *   - sweeps the remaining balance to SPONSOR_ADDRESS,
   *   - burns the 0.2 XRP owner-reserve fee,
   *   - requires the account to be ~15 min old (Sequence + 255 <= ledger index),
   *     which the sweeper enforces via BURNER_DESTROY_DELAY_MS,
   *   - requires no owner objects (a burner that only received XRP and made
   *     outgoing Payments qualifies),
   *   - uses failHard so a failed delete doesn't burn the fee.
   */
  async destroyBurner(address) {
    const seed = this._seedFor(address);
    if (!seed) {
      logger.warn('Burner sweep skipped: seed no longer held in memory', { address });
      return false;
    }

    const burnWallet = xrpl.Wallet.fromSeed(seed);
    if (burnWallet.classicAddress !== address) {
      throw new Error('Burner seed does not match its address');
    }

    const cfg = await getBurnerSettings();
    const destination = cfg.sponsorAddress || burnWallet.classicAddress;
    if (destination === address) {
      throw new Error('AccountDelete destination cannot be the burner itself');
    }

    let client = null;
    try {
      client = new xrpl.Client(xrplUrl());
      await client.connect();

      const accountDelete = await client.autofill({
        TransactionType: 'AccountDelete',
        Account: address,
        Destination: destination
      });
      const signed = burnWallet.sign(accountDelete);
      const prelim = await client.submit(signed.tx_blob, { failHard: true });

      if (prelim.result && prelim.result.engine_result !== 'tesSUCCESS') {
        // tecTOO_SOON (account not old enough) → caller retries later.
        logger.logP2P('burner_delete_deferred', {
          address,
          engineResult: prelim.result.engine_result,
          engineResultMessage: prelim.result.engine_result_message
        });
        return false;
      }

      await waitForValidation(client, signed.hash);
      await pool.query(
        `UPDATE burner_wallets
         SET status = 'destroyed', deleted_at = NOW()
         WHERE address = $1`,
        [address]
      );
      this._dropSeed(address);

      logger.logP2P('burner_destroyed', { address, txHash: signed.hash });
      return true;
    } finally {
      if (client) {
        try { await client.disconnect(); } catch (_) { /* already closed */ }
      }
    }
  }

  /**
   * One sweep pass: find burners old enough to delete whose trade is over and
   * destroy them. Called on an interval by startSweeper().
   */
  async runSweep() {
    const cfg = await getBurnerSettings();
    const cutoff = new Date(Date.now() - cfg.destroyDelayMs).toISOString();
    const result = await pool.query(
      `SELECT address, order_id, status
       FROM burner_wallets
       WHERE status IN ('active', 'sweep_pending')
         AND created_at <= $1
       LIMIT 100`,
      [cutoff]
    );

    let destroyedCount = 0;
    for (const burner of result.rows) {
      if (!await this._isSweepEligible(burner)) {
        continue;
      }
      try {
        const destroyed = await this.destroyBurner(burner.address);
        if (destroyed) {
          destroyedCount += 1;
        }
      } catch (err) {
        // tecTOO_SOON and transient network errors are non-fatal; the next
        // sweep pass will retry.
        logger.warn('Burner sweep failed for one wallet (will retry)', {
          address: burner.address,
          error: err.message
        });
      }
    }

    if (destroyedCount > 0) {
      logger.info(`Burner sweep: destroyed ${destroyedCount} wallet(s)`);
    }
  }

  /**
   * A burner may be destroyed once its order is finished (or abandoned) AND
   * the account age threshold has been met (enforced by the SQL cutoff).
   * Burners that never placed an order hold only the sponsored reserve and
   * are recovered immediately after the age threshold.
   */
  async _isSweepEligible(burner) {
    if (!burner.order_id) {
      return true;
    }
    const orderResult = await pool.query(
      'SELECT status FROM p2p_orders WHERE order_id = $1 OR id::text = $1',
      [burner.order_id]
    );
    const order = orderResult.rows[0];
    if (!order) {
      return true;
    }
    return TERMINAL_ORDER_STATUSES.includes(order.status);
  }

  /**
   * Start the periodic sweeper. Returns the timer so the caller can unref it.
   */
  startSweeper() {
    if (this.sweepTimer) {
      return this.sweepTimer;
    }

    const run = async () => {
      try {
        await this.runSweep();
      } catch (err) {
        logger.error('Burner sweep pass failed', { error: err.message });
      }

      const cfg = await getBurnerSettings();
      if (this.sweepTimer) {
        this.sweepTimer = setTimeout(run, cfg.sweepIntervalMs);
        this.sweepTimer.unref();
      }
    };

    getBurnerSettings().then((cfg) => {
      if (!cfg.sponsorSeed) {
        logger.warn('Burner sweeper not started: sponsor_seed is not configured in DB or env');
        return;
      }
      this.sweepTimer = setTimeout(run, cfg.sweepIntervalMs);
      this.sweepTimer.unref();
    }).catch((err) => {
      logger.error('Failed to bootstrap burner sweeper', { error: err.message });
    });

    return true;
  }

  stopSweeper() {
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}

module.exports = new BurnerWalletService();
