# Two-Tier Users: Verified Sellers + Burner Buyer Wallets

Status: **Proposed** — implementation plan, not yet applied.
Owner: CryptoPay core team.

## Problem Statement

The app currently treats every user identically: anyone creates a persistent wallet,
and `fundWallet()` faucet-funds it with **100 XRP on testnet**. We need two distinct
user types:

| User | Who are they | Wallet | Balance |
| --- | --- | --- | --- |
| **Seller** | Verified by us, limited number | **Constant** account (current behavior) | Faucet-funded so they can stock XRP to sell |
| **Buyer** | Random guest | **Fresh burner wallet per transaction, destroyed after** | **0 spendable XRP** (no faucet 100 XRP) |

The testnet faucet grant (100 XRP) is unacceptable for buyers — they should only ever
have the XRP they actually paid for (in TRY).

## Decisions Locked With Stakeholders

1. **XRP destination after the trade:** stays in the burner wallet for the session; the
   buyer sends it out manually (existing SendFlow) before the wallet is destroyed.
2. **"Destroy the wallet" meaning:** **real on-ledger destruction** via `AccountDelete`
   (sweeps remaining balance to a `Destination`, burns 0.2 XRP). Deferred/backgrounded
   because of the ledger's ~15-minute account-age rule.
3. **"0 XRP start":** the **platform sponsors** exactly the base reserve (~1 XRP) to each
   fresh buyer wallet so it exists on-ledger; the buyer has **0 spendable XRP**. Reserve is
   recovered later via `AccountDelete`.
4. **Seller verification:** a **`role` column on `wallets`** + **admin/moderator toggle**.
   Sell-order creation is gated to `role = 'seller'`.

## XRPL Constraints (verified against xrpl.org)

- **EscrowFinish cannot fund an account.** `EscrowCreate`/`EscrowFinish` to an unfunded
  address fails with `tecNO_DST`. Therefore the buyer's fresh address MUST already be
  funded (≥ base reserve) before a seller can escrow XRP to it → the platform must
  pre-fund the burner with exactly the base reserve.
- **AccountDelete** is the only true on-ledger destroy:
  - Sweeps the account's entire remaining balance to a `Destination` (a funded account).
  - Burns a special fee = **0.2 XRP** (owner reserve).
  - Requires the account to be **~15 min old** (`tecTOO_SOON`: `Sequence + 255 ≤ ledger index`).
  - Requires **no owner objects** (no trust lines/escrows/checks). A burner that only
    received XRP and made outgoing Payments qualifies.
  - Use `failHard: true` when submitting so a failed delete doesn't burn the 0.2 XRP fee.
- Base reserve is currently **1 XRP** (owner reserve 0.2 XRP) and can change → fetch it
  dynamically from `server_state` (`reserve_base`), never hardcode.
- Current code hardcodes a stale **10 XRP** reserve in `sendPayment`
  (`src/hooks/useXRPL.js:286`). This blocks burner withdrawals (buyers only have a 1 XRP
  reserve) and must be made dynamic.

## Architecture Overview

```
Guest buyer                       Platform sponsor account (SPONSOR_SEED)
   │  POST /api/burner/wallets          │
   │───────────────────────────────────►│  Wallet.generate() (0 XRP, no faucet)
   │◄──────── {address, seed, jwt}──────│  Payment of baseReserve (1 XRP) -> burner
   │                                    │  seed held IN-MEMORY only (TTL ~1h)
   │  place buy order / quick-match      │
   │  pay TRY (Papara etc.)              │
   │  seller escrows XRP -> burner       │  (destination already funded: OK)
   │  withdraw XRP via SendFlow          │
   │                                    │
   │  (session ends / order completes)   │  Sweeper (interval):
   │                                    │  wait ~15 min (tecTOO_SOON) ->
   │                                    │  AccountDelete -> SPONSOR_ADDRESS
   │                                    │  recover ~0.8 XRP, account destroyed
```

Net platform cost per buyer ≈ **0.2 XRP** (1.0 sponsored − 0.8 recovered − fees).

## File Change Plan

### 1. Data model — `database/migrations/010_roles_and_burners.sql` (new)

- `ALTER TABLE wallets ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer','seller'));`
- `CREATE INDEX idx_wallets_role ON wallets(role);`
- New `burner_wallets` table (**never stores the seed** — consistent with "server never
  holds seeds" where possible; only lifecycle metadata):
  ```sql
  CREATE TABLE IF NOT EXISTS burner_wallets (
      address      VARCHAR(34) PRIMARY KEY,
      order_id     VARCHAR(36),
      status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','sweep_pending','destroyed')),
      funded_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      deleted_at   TIMESTAMP WITH TIME ZONE
  );
  CREATE INDEX IF NOT EXISTS idx_burner_wallets_status ON burner_wallets(status);
  ```
- Mirror the same definitions into `database/schema.sql` so fresh installs and Docker
  volumes get them too.

### 2. Backend — roles & seller gating

- `database/dal/wallets.js`
  - Include `role` in every SELECT.
  - Add `setRole(address, role)`, `getByRole(role)`.
- `middleware/auth.js`
  - Load `role` in the existing query and attach `role` to `req.user`.
- `server.production.js` (primary server)
  - `POST /api/p2p/create-order` (≈ line 629): reject `type === 'sell'` with **403** unless
    `req.user.role === 'seller'`. Buy orders remain open to any role (buyers use burners).
  - `GET /api/p2p/quick-match` (≈ line 539): once sell orders are seller-only, the order
    book only contains verified sellers — no extra filter needed, but keep the existing
    Papara-number filter.
  - New moderator endpoints (guarded by `MODERATOR_API_KEY`, next to `/api/moderator/*`):
    - `GET /api/moderator/sellers` → list wallets with `role = 'seller'` (or all + role).
    - `POST /api/moderator/sellers` `{ address, role: 'seller' | 'buyer' }` → upsert the
      wallet row and set the role.
- `server.js` (dev server)
  - Mirror the same route additions. See **Drift note** below.

### 3. New `services/burnerWalletService.js`

Responsibilities:
- `createBurner()`:
  1. `xrpl.Wallet.generate()` — **no faucet** → 0 XRP.
  2. Connect to `XRPL_TESTNET_URL`, read `reserve_base` from `server_state`.
  3. Sign + submit a `Payment` of exactly `reserve_base` (drops) from the platform sponsor
     account (`SPONSOR_SEED` env) to the fresh address → account exists, **0 spendable XRP**.
  4. Hold the seed in an **in-memory Map** (keyed by address, TTL ~1h, never persisted).
  5. Insert a `burner_wallets` row (`status='active'`).
  6. Issue a **short-lived JWT** for the guest session (same challenge/verify flow works —
     the address is now funded).
  7. Return `{ address, seed, reserveXrp, token }`.
- `getBurner(address)` — fetch from memory/DB.
- `markOrderSettled(address, orderId)` — set `status='sweep_pending'`, record order_id.
- `destroyBurner(address)` — internal: submit `AccountDelete` (Destination = `SPONSOR_ADDRESS`,
  `failHard: true`), on success mark `destroyed` and drop the in-memory seed.
- **Sweeper** — `setInterval` started in `startServer` next to the existing escrow sweep
  (≈ `server.production.js:2521`):
  - Every `BURNER_SWEEP_INTERVAL_MS` (default 60s), pick burners whose age ≥
    `BURNER_DESTROY_DELAY_MS` (default 16 min — clears `tecTOO_SOON`) and whose order is
    `completed` / `cancelled` / `expired`.
  - `tecTOO_SOON` → retry later (no-op this pass).
  - Success → mark `destroyed`, discard seed.
  - Skip if the burner still holds purchased XRP beyond the reserve? **Decision needed** —
    see Grace period below.

Security notes:
- Rate-limit `createBurner` aggressively (e.g., 3 per 15 min per IP) to prevent account
  farming.
- Seeds are zero-value throwaway account keys, held in-memory only, TTL'd, never written
  to disk/DB. This is a deliberate, documented deviation from "server never holds seeds",
  limited to burner wallets.

### 4. Frontend — guest buyer flow + role awareness

- `src/hooks/useXRPL.js`
  - Add `createBurnerWallet()` → `POST /api/burner/wallets`, store wallet in **React state
    only** (never `walletStorage`/`localStorage`).
  - **Fix `sendPayment`** (≈ lines 283-294): replace hardcoded `BASE_RESERVE_XRP = 10` with
    a dynamically-fetched reserve; for burner wallets allow sending down to
    `balance − reserve − fee`.
  - Add a `sessionType: 'seller' | 'buyer'` concept; burners skip the "Save wallet"
    password flow.
- `src/components/Home.js`
  - On the no-wallet screen, add a primary **"Buy XRP — no wallet needed"** action that
    starts a burner session and opens `AddFunds`. Keep "Create my wallet" / "Unlock saved
    wallet" for sellers.
  - Show a notice: "Your temporary wallet is destroyed after this purchase — withdraw your
    XRP first."
- `src/components/AddFunds.js` / `src/components/P2PExchange.js` / `src/components/OrderForm.js`
  - Wire the active wallet (burner) as `userAddress`; poll order status by burner address.
  - Hide the **Sell** option for non-sellers.
- `src/components/Header.js` / `TabBar.js`
  - Show a small "guest session — temporary wallet" indicator for burner sessions.

### 5. Environment / config (`.env.example`)

```
SPONSOR_SEED=<seed of the platform account that funds burner reserves>
SPONSOR_ADDRESS=<address of the same account (AccountDelete destination)>
BURNER_SWEEP_INTERVAL_MS=60000
BURNER_DESTROY_DELAY_MS=960000        # ≥ ~15 min (clears tecTOO_SOON)
# Optional:
# MAX_SELLERS=25
```

### 6. Tests (80% coverage gates apply — `npm test`)

- Backend:
  - `create-order` gating: `type='sell'` → 403 for `role='buyer'`, 201 for `role='seller'`.
  - Moderator seller toggle endpoint (set/unset, auth guard).
  - `burnerWalletService` unit tests with a mocked `xrpl.Client`:
    - sponsor Payment of exactly `reserve_base`;
    - AccountDelete success path;
    - `tecTOO_SOON` retry path;
    - `failHard` submission.
  - Sweeper behavior tests (age threshold, status filtering, seed cleanup).
- Frontend:
  - `Home` guest entry renders and starts a burner session.
  - `useXRPL` burner creation (fetch mock) and in-memory-only storage.
  - `sendPayment` dynamic-reserve math for burner wallets.
- Update any existing tests that assume arbitrary users can create sell orders.

### 7. Drift note (must-fix alongside)

`Dockerfile` `CMD`s `node server.js` while `npm start` / `ecosystem.config.js` run
`server.production.js` (documented in `AGENTS.md`). The plan targets
`server.production.js` as primary and mirrors endpoints into `server.js`; **correct the
Dockerfile CMD to `server.production.js`** as part of this work.

## Open Questions / Risks

1. **Burner seed custody.** The server must hold burner seeds in-memory to submit
   `AccountDelete` later. In-memory only, TTL ~1h, zero-value accounts. In **PM2 cluster
   mode** workers share no memory → either run single-instance or accept a per-worker
   registry (documented limitation). Alternative: store seeds encrypted at rest briefly
   (rejected for now — more secret-handling surface).
2. **Grace period before destroy.** The buyer must withdraw purchased XRP before the
   sweeper runs. Proposal: destroy only after the order is `completed`/`cancelled`/`expired`
   AND age ≥ `BURNER_DESTROY_DELAY_MS`; anything left is swept to the sponsor. Decide
   whether to extend this (e.g., 24h) so buyers who delay aren't burned.
3. **Instant vs. deferred delivery.** `AccountDelete` is ~15 min after the trade, not
   instant — the buyer cannot receive their reserve back instantly, and purchased XRP is
   spendable only during the session. Confirm this is acceptable for the testnet demo.
4. **Buyer who never opens SendFlow.** If a buyer leaves purchased XRP in the burner, the
   sweep sends it to the sponsor. The UX must warn clearly at purchase time and/or
   auto-prompt withdrawal at session end.
5. **Testnet reserve value.** Confirm current testnet `reserve_base` (expected 1 XRP). The
   implementation reads it from `server_state` at runtime, so no hardcode.

## Suggested Implementation Order

1. Migration 010 + `schema.sql`; `WalletsDAL` role methods; `auth.js` role in `req.user`.
2. `burnerWalletService.js` (create + sweeper) + `SPONSOR_*` env; wire into
   `server.production.js` startup.
3. Endpoints: `POST /api/burner/wallets`, moderator seller endpoints, sell-order gating.
4. Frontend: `useXRPL` burner + `sendPayment` reserve fix → `Home` guest entry → wire
   AddFunds/P2P/SendFlow.
5. Dockerfile CMD fix; mirror into `server.js`.
6. Tests + `npm test`, `npm run lint`, `npm run build`.
