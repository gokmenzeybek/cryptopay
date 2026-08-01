# CryptoPay — Product & Technical Plan

### A privacy-driven money transfer system, settled on the XRP Ledger

**Version:** 1.0 · **Date:** 2026-07-28 · **Status:** Approved direction (pending phased implementation)

***

## Table of Contents

1. [Product Definition](#1-product-definition)
2. [Design Principles](#2-design-principles)
3. [What Exists Today](#3-what-exists-today)
4. [Target User Experience](#4-target-user-experience)
5. [System Architecture](#5-system-architecture)
6. [The Money Flows](#6-the-money-flows)
7. [On-Ramping Strategy (TRY → XRP)](#7-on-ramping-strategy-try--xrp)
8. [Privacy Model](#8-privacy-model)
9. [Component-Level Implementation Plan](#9-component-level-implementation-plan)
10. [API Surface — Current and Required](#10-api-surface--current-and-required)
11. [Data Model Changes](#11-data-model-changes)
12. [Build Order & Milestones](#12-build-order--milestones)
13. [Risks & Open Questions](#13-risks--open-questions)

***

## 1. Product Definition

**CryptoPay is a privacy-driven money transfer app.** To the user, it works like
Cash App or Venmo: *"I want to send Ahmet ₺500"* — and it happens in seconds.
Underneath, value moves as XRP on the XRP Ledger, and the conversion between
Turkish Lira and XRP is handled by a non-custodial peer-to-peer rail that the
user never has to think about.

**One-sentence pitch:** *Send money to anyone, as easily as a messaging app —
settled in \~4 seconds on the XRP Ledger, with no company holding your funds,
your identity, or your transaction history.*

### What it is NOT

* **Not an exchange.** The P2P order book, matching engine, and escrow system
  are internal liquidity infrastructure — the "rail" — not the user-facing
  product. Users never "place orders" in the target experience; they send and
  receive money.

* **Not a bank or custodian.** At no point does the operator hold user funds,
  user seeds, or user identity documents. The server is blind infrastructure.

* **Not anonymous in the cryptographic sense.** XRPL is a *pseudonymous* public
  ledger. Our privacy promise is about what **we** collect and hold (nothing),
  plus on-chain hygiene — not about hiding ledger activity from chain analysis.

### The two product promises

| Promise            | Meaning                                                                                                                                              | How it's measured                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Smooth as fuck** | Sending money takes < 30 seconds of user effort, to a human-readable recipient, with zero blockchain jargon on the happy path.                       | Time-to-complete a send; taps required (target: ≤ 5).            |
| **Privacy-driven** | No accounts, no email, no phone, no KYC on our side. Identity = an XRPL keypair. Server stores the operational minimum and deletes it on a schedule. | PII fields in DB: zero. Data retention: documented and enforced. |

***

## 2. Design Principles

Every product and engineering decision is checked against these, in order:

1. **Non-custodial, always.** Seeds are generated in the browser, encrypted
   client-side (PBKDF2 + AES-GCM), and never transmitted. The server cannot
   move user funds even if compromised or compelled. *(Already true today.)*
2. **The rail is invisible.** Matching, escrow, rates, fees — all happen behind
   a "Send" button. If a screen requires understanding crypto to use, it is a
   bug in the product, not a feature.
3. **Collect nothing.** If a piece of data is not strictly required to settle a
   payment, we do not store it. When in doubt, keep it client-side only.
4. **Plain language.** UI copy says "send", "receive", "add funds" — never
   "EscrowCreate", "order book", "matching". Technical terms are allowed only
   in collapsible "details" sections for power users.
5. **Fast by default.** XRPL finality is 3–5 seconds; the UI should feel faster
   than a banking app, not slower. Optimistic feedback, no spinners without
   progress context.
6. **Honest about trust.** Where the system is *not* trustless (the TRY fiat
   leg between peers), the UI says so and shows the protection that does exist
   (escrow on the crypto leg, dispute path, moderator).

***

## 3. What Exists Today

### 3.1 Working and production-hardened (PRD Phases 1–4, complete 2026-07-28)

| Capability                                                              | Where                                                                                     | Notes                                                                                                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Client-side wallet creation/loading, seed encrypted with PBKDF2+AES-GCM | `src/services/walletStorage.js`, `src/hooks/useXRPL.js`                                   | Server never receives seeds. Encrypted export exists.                                                                                     |
| Keypair-challenge JWT auth (no email/password/PII)                      | `/api/auth/challenge` + `/api/auth/verify`, `src/services/authService.js`                 | Identity = XRPL address. All mutating API calls authed via `authFetch`.                                                                   |
| Direct XRP payment with reliable submit + ledger validation             | `useXRPL.sendPayment`                                                                     | \~4s finality; base-reserve and unfunded-recipient rules handled with plain-language errors.                                              |
| Payment requests stored + listed (authed)                               | `POST/GET /api/payment_requests`                                                          | QR rendering via `qrcode` lib exists in `RequestPayment`.                                                                                 |
| P2P order book with atomic matching                                     | `services/p2pMatchingService.js`, `P2POrdersDAL.matchOrders`                              | State machine: `open → matched → payment_confirmed → completed` (+cancel/dispute/expiry). All status writes go through `transitionOrder`. |
| On-ledger XRPL escrow for trades                                        | `services/xrplEscrowService.js`, `/api/p2p/prepare-escrow`, `/api/p2p/submit-escrow-hash` | Seller signs EscrowCreate **client-side** (4.6.3 UI built); server verifies on-chain before recording lock.                               |
| Dispute + moderator endpoints                                           | `/api/moderator/*`                                                                        | Guarded by `MODERATOR_API_KEY` (required in production).                                                                                  |
| Papara integration                                                      | `services/paparaService.js`, HMAC-verified `/api/webhooks/papara`                         | Sandbox-verified; production credentials pending (external blocker).                                                                      |
| Live XRP/TRY rate                                                       | `services/tryRateScraperService.js`                                                       | Weighted average of BTCTurk/Paribu/Binance/CoinGecko, cached 300s.                                                                        |
| React frontend build                                                    | CRA / react-scripts 5                                                                     | Builds clean; xrpl.js loaded via pinned+SRI CDN (`xrpl@3.1.0`).                                                                           |

### 3.2 The gap to the product vision

| #  | Gap                                                                                                                | Impact                                                                                |
| -- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| G1 | Home screen is a wallet management page; "send money" is a form tab among six.                                     | First-run user doesn't understand what the app is for.                                |
| G2 | Recipient is a raw `r...` address with no scan/link/contact concept.                                               | Sending to a human is practically impossible without copy-paste over another channel. |
| G3 | Payment request exists but produces an in-app QR only — no shareable link, no "open → pre-filled pay screen" loop. | No viral "just send me a link" flow.                                                  |
| G4 | Order book requires understanding buy/sell/matching; matching requires creating your own counter-order.            | On-ramp is unusable for non-traders.                                                  |
| G5 | Fiat leg (TRY) is honor-system between peers; disputes are the only recourse.                                      | Trust friction on every on/off-ramp.                                                  |
| G6 | `window.prompt` for wallet password; no proper unlock screen.                                                      | Feels like a dev tool, not a consumer product.                                        |
| G7 | Wallet password/cancel-reason prompts and tab-based navigation are desktop-era patterns.                           | Mobile experience (where money transfer lives) is weak.                               |
| G8 | No expiry sweeper for stale escrows/orders; escrow release not exposed in UI after payment confirmation.           | Trades can stall mid-flow with locked funds.                                          |

***

## 4. Target User Experience

### 4.1 First run (new user, < 60 seconds)

1. App opens → short splash: "Private payments, settled in seconds."
2. **One tap: "Create my wallet"** — keypair generated in-browser instantly;
   encrypted with a user-chosen PIN/password via a proper modal (not
   `window.prompt`). No email, no name, no phone.
3. Shown their **receive address as a QR** and a plain-language backup prompt:
   "Back up your wallet" → encrypted export file + recovery instructions.
4. Lands on **Home** (balance 0 XRP, big Send/Request buttons, "Add funds"
   entry point).

No seed phrase is shown on the happy path. Advanced users can reveal/export
from Settings.

### 4.2 Flow A — Send money (the daily driver)

```
Home → [Send] → recipient (paste | scan 📷 | from recent) → amount (XRP or ₺)
→ Confirm sheet → success in ~4s
```

* **Recipient field**: paste an address (live validation with friendly
  errors), tap the camera icon to scan a QR inline, or pick from
  *recent recipients* (client-side-only labels, never synced to server).

* **Amount**: numeric keypad; toggle XRP ⇄ TRY with live conversion from
  `/api/p2p/rate`. Both values shown; the ledger settles in XRP.

* **Memo**: hidden behind "Add a note". Inline warning: *"Notes are public on
  the XRP Ledger — don't include personal information."* (Privacy rule P3.)

* **Confirm sheet**: one shared component (see §9.4) — amount in XRP + ₺,
  recipient (truncated + copy), network fee (\~0.00001 XRP), slide-to-confirm
  on mobile / big button on desktop.

* **Success**: checkmark animation, "Sent in 3.8s", recipient + amount,
  tx hash collapsed under "Technical details". Failure: plain-language reason
  (unfunded recipient → base reserve; insufficient balance; network issue).

### 4.3 Flow B — Request money (the viral loop)

```
Home → [Request] → amount (+ optional private note) → link + QR → share anywhere
Sender opens link → lands on pre-filled Confirm sheet → one tap → done
```

* Produces a **payment link**: `/pay?to=<addr>&amount=<xrp>&req=<request_id>`
  plus the same link encoded as a QR (works for in-person scans AND remote
  sharing — one artifact, two transports).

* **Private note** (e.g. "for dinner") is stored server-side with the request,
  shown to the sender on the confirm screen, and **never written on-chain**.

* Copy link / native mobile share sheet / show QR — three share paths.

* When a payment arrives matching the request, it's marked paid (see §10, new
  endpoint) and the requester sees it in Activity.

### 4.4 Flow C — Scan first

```
Home → [Scan] → camera → QR decoded → pre-filled Confirm sheet → one tap
```

Converges with Flow A's confirm screen. QR payloads accepted: payment links
(Flow B) and plain `r...` addresses.

### 4.5 Flow D — Add funds / Cash out (the on-ramp, Phase B)

```
Home → [Add funds] → amount in ₺ → app finds best available seller →
escrow locks automatically → user gets pre-filled Papara transfer instructions
(recipient, exact amount, reference code) → taps "I've sent it" →
seller confirms → XRP lands in wallet
```

* The user **never sees the order book.** The broker flow (§7.2) takes orders
  on their behalf.

* Cash out is the mirror: sell XRP → receive Papara transfer from a buyer.

* The full P2P interface remains available as the "Convert" tab for power
  users and market makers — it is *a* screen, not *the* product.

***

## 5. System Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ React UI     │  │ Wallet        │  │ XRPL client (xrpl.js)  │ │
│  │ (Send/       │  │ seed: PBKDF2  │  │ pinned+SRI CDN         │ │
│  │  Request/    │─▶│ +AES-GCM,    │─▶│ signs ALL txs locally   │ │
│  │  Home/       │  │ localStorage  │  │ testnet (→mainnet-ready)│ │
│  │  Convert)    │  │ never leaves  │  │                        │ │
│  └──────┬───────┘  └──────────────┘  └───────────┬────────────┘ │
└─────────┼────────────────────────────────────────┼──────────────┘
          │ HTTPS (JWT via keypair challenge)      │ WSS
          ▼                                        ▼
┌──────────────────────────────┐      ┌──────────────────────────┐
│      CryptoPay SERVER        │      │      XRP LEDGER          │
│  Express API (port 5001)     │      │  (testnet today)         │
│  ┌────────────────────────┐  │      │                          │
│  │ Auth: challenge/JWT     │  │      │  • Payments (XRP)        │
│  │ P2P matching engine     │  │      │  • EscrowCreate/Finish   │
│  │ Escrow preparation      │  │      │    (trade settlement)    │
│  │   (unsigned txs only)   │  │      │                          │
│  │ Rate service (scraped   │  │      └──────────────────────────┘
│  │   weighted average)     │  │
│  │ Papara webhook (HMAC)   │  │      ┌──────────────────────────┐
│  │ WebSocket order updates │  │      │  FIAT LAYER (off-system) │
│  └───────────┬────────────┘  │      │  Papara / bank / İninal  │
└──────────────┼───────────────┘      │  — direct peer-to-peer,  │
               ▼                      │    we never touch it     │
┌──────────────────────────────┐      └──────────────────────────┘
│  PostgreSQL                  │
│  wallets (addresses only),   │
│  transactions, payment_      │
│  requests, p2p_orders,       │
│  matches, papara_payments,   │
│  rate_history, settings      │
└──────────────────────────────┘
```

**Key architectural invariants (must survive every future change):**

* **I1 — Seeds never leave the browser.** All signing is client-side. Server-
  side XRPL code prepares *unsigned* transactions and *verifies* on-chain
  state; it never signs for a user.

* **I2 — The server is blind infrastructure.** Compromising the server yields:
  addresses, amounts, order history. Never funds, never seeds, never identity
  documents.

* **I3 — Fiat never enters the system.** TRY moves directly between users'
  Papara/bank accounts. The app coordinates and escrows; it does not transmit
  fiat.

* **I4 — Layering:** routes → `services/` → `database/dal/`. API envelope
  `{ success: boolean, ... }`. Winston logging, no PII in logs.

* **I5 — XRPL testnet until a deliberate mainnet decision** (§13, Q1).

***

## 6. The Money Flows

### 6.1 Crypto-native send (Flow A/C) — trustless end to end

```
Sender UI ──sign Payment──▶ XRPL ──▶ recipient's wallet    (~4s, final)
     │
     └──▶ POST /api/transactions (record for history; hash-verifiable)
```

No server involvement in settlement. Server only records the completed tx for
the sender's activity list (hash, from/to, amount, timestamp).

### 6.2 Payment request (Flow B) — coordination only

```
Requester ──▶ POST /api/payment_requests {amount, note} ──▶ link/QR
Sender opens link ──▶ GET /api/payment_requests/:id ──▶ Confirm sheet
──▶ [6.1 send] ──▶ PATCH /api/payment_requests/:id/paid {txHash}
```

### 6.3 On-ramp trade (Flow D) — crypto leg trustless, fiat leg peer-to-peer

```
                 ┌─── SELLER (has XRP) ──────────────┐
                 │ posts sell order (or market maker) │
                 └──────────────┬─────────────────────┘
                                ▼
BUYER (has TRY)        MATCHING ENGINE          state machine:
  │                    pairs orders             open→matched
  │                         │
  │                         ▼
  │              SELLER signs EscrowCreate ──▶ XRPL escrow LOCKED
  │                         │
  ├── Papara transfer (outside app, P2P) ──▶ SELLER's Papara
  │                         │
  ├── "I paid" ──▶ payment_confirmed        │
  │                         ▼
  │              SELLER confirms ──▶ EscrowFinish ──▶ XRP to BUYER
  │                         │
  └── dispute? ──▶ moderator resolution ──▶ finish OR refund
```

**Trust properties:** buyer cannot lose XRP-side value (escrow releases only
per the flow or via dispute); seller's risk is fiat chargeback/fraud on the
Papara leg — mitigated by Papara's own transfer finality and the dispute
record. Neither party's crypto is ever held by the platform.

***

## 7. On-Ramping Strategy (TRY → XRP)

### 7.1 The deliberate choice: no custodial on-ramp

Stripe/MoonPay-style ramps require KYC, custody, and money-transmitter
obligations — all incompatible with the product's identity (§1). **Our
on-ramp is the P2P book + escrow.** This section is about making that rail
feel like a one-tap purchase.

### 7.2 The broker flow (Phase B — the real product work)

Behind the "Add funds" button:

1. User enters a TRY amount.
2. Server picks the best available sell order(s) — best rate, payment method
   match, min/max bounds — using the existing matching engine (extended with a
   `POST /api/p2p/quick-match` convenience endpoint; no new matching logic).
3. Seller locks escrow (market-maker sellers can be configured to auto-lock
   via their own running client; regular sellers get a notification to lock).
4. Buyer receives **pre-filled transfer instructions**: Papara number, exact
   amount, a unique reference code (stored server-side, included in the
   Papara transfer description so the seller can reconcile).
5. Buyer taps "I've sent it" → `payment_confirmed` → seller confirms →
   escrow releases.

From the user's seat: *enter amount → send one Papara transfer → XRP arrives.*
Two minutes, one decision, zero jargon.

### 7.3 Liquidity bootstrapping (business, not code)

* **Operator market-maker wallet**: the operator funds a wallet and runs a
  seller bot (posts competitive sell orders, auto-locks escrows, reconciles
  Papara reference codes). This guarantees early users always see liquidity.
  Inventory risk and TRY/XRP treasury management are the operator's business
  decision; the code needed is minimal (a bot using existing endpoints).

* **Maker incentives** (later): zero-fee tiers, rate spread to makers.

* Success metric: median time from "Add funds" tap to XRP in wallet < 5 min.

### 7.4 Explicitly rejected options

| Option                                                    | Why rejected                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Third-party custodial ramp (MoonPay et al.)               | KYC + custody contradicts the product promise; can be revisited only as a separate, clearly-labeled optional provider. |
| Platform-run Papara merchant account collecting user fiat | Puts the operator in the money flow (legal, custodial, privacy). Breaks invariant I3.                                  |

***

## 8. Privacy Model

### 8.1 What we never have

* Seeds, private keys, decrypted wallets (invariant I1)

* Email addresses, phone numbers, names, national IDs, selfies — **no KYC tier exists in the codebase and none may be added to the core flow**

* Fiat payment instrument details (Papara account numbers are exchanged
  peer-to-peer for a specific trade, stored only on the order for its
  lifecycle, and are the *user's own* data they chose to publish to
  counterparties)

### 8.2 What the server stores (and why)

| Data                                                              | Justification                             | Retention target                                                          |
| ----------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| XRPL addresses (wallet registration)                              | Auth identity, order ownership            | Until user deletes (add delete-account endpoint)                          |
| Transactions (hash, from/to, amount)                              | Activity list; all public on-chain anyway | Matches ledger (public data)                                              |
| Payment requests (amount, note, addresses)                        | Request links work                        | **Auto-expire after 30 days; purge job**                                  |
| P2P orders + matches (amounts, rates, addresses, payment methods) | The rail functions                        | Completed/cancelled orders purged after 90 days (dispute evidence window) |
| Papara payment records (our own integration only)                 | Webhook reconciliation                    | Per accounting needs of operator                                          |

### 8.3 On-chain hygiene rules (enforced in UI)

* **P1 — Memo discipline.** Memos are public and immutable. UI hides them
  behind opt-in with a warning; private notes go to the server record only.

* **P2 — No address reuse nudging.** Receiving QR always shows the same wallet
  (XRPL accounts are address-stable — a protocol constraint we accept and
  document honestly), but the UI never publishes addresses anywhere the user
  didn't explicitly share them.

* **P3 — No PII in logs.** Frontend `console.log` purge done (PRD 4.5.3);
  backend Winston logs must be audited for addresses/memos in Phase C.

* **P4 — No third-party trackers.** No analytics SDKs, no crash-reporting
  SaaS, no fonts/CDNs that leak IPs except the pinned+SRI xrpl.js CDN
  (self-hosting it is a planned hardening step — the file already ships in
  `node_modules/xrpl/build/`).

### 8.4 Honest limits (to be stated in-app, "About privacy" screen)

* All XRP movements are visible on the public ledger. Anyone with your
  address can see its history. We minimize *our* knowledge; we cannot change
  the ledger's transparency.

* The TRY leg goes through Papara/banks, which are fully regulated and KYC'd
  *on their side*. Counterparties see your Papara number for that trade.

***

## 9. Component-Level Implementation Plan

### 9.1 `Home.js` (new) — replaces Wallet as `/`

* Balance card: XRP balance + ₺ equivalent (rate service), tap to toggle.

* Two primary actions: **Send**, **Request**; secondary: **Scan**, **Add funds**.

* Activity list: last 10 items merged from `/api/transactions` and
  `/api/payment_requests` (incoming/outgoing, status chips).

* First-run empty state: QR of own address + "Share this to receive" +
  backup reminder (if not yet exported).

* Wallet management (export, lock, network info) moves to a Settings sheet.

### 9.2 `SendFlow.js` (new) — absorbs `Payment.js`

* Steps as one continuous screen (not a wizard): recipient → amount → review.

* Recipient input with inline validation (`window.xrpl.isValidClassicAddress`),
  scan button (embeds the existing scanner inline), recent-recipient chips
  (localStorage-only labels).

* Amount with XRP/₺ toggle (rate from `/api/p2p/rate`); shows both values.

* URL-driven pre-fill: `?to=&amount=&memo=&req=` (extends Payment's existing
  `?to=` support) — this is the landing point of payment links.

* Memo opt-in with public-ledger warning.

* Unlocked-wallet check → routes to unlock modal (§9.6) instead of failing.

### 9.3 `RequestFlow.js` (rewrite of `RequestPayment.js`)

* Amount (+ optional private note, clearly labeled "only visible in the app,
  never on the blockchain").

* Output: payment link `/pay?to=<addr>&amount=<x>&req=<id>` rendered as QR
  (existing `qrcode` lib) + copy button + `navigator.share` on mobile.

* "My open requests" list with status (pending/paid/expired).

### 9.4 `ConfirmSheet.js` (new, shared) — the single point of smoothness

* Props: `{ recipient, amountXrp, memo?, requestId?, onDone }`.

* Renders: amount (XRP + ₺), recipient (truncated, copyable, "first time
  sending to this address" hint when applicable), fee, optional note from the
  request record, slide-to-confirm.

* Executes via existing `useXRPL.sendPayment`; on success, if `requestId`
  present → `PATCH /api/payment_requests/:id/paid { txHash }`.

* Success/failure states as in §4.2. Used by SendFlow, scan flow, and link
  landings — **three entrances, one polished component.**

### 9.5 `QRScanner` — demoted from tab to embedded widget

* Keep `@yudiel/react-qr-scanner`; wrap as `<ScanSheet onResult>` used inside
  SendFlow and Home. Parse: payment link → route to ConfirmSheet; bare
  address → pre-fill SendFlow.

### 9.6 `UnlockModal.js` (new) — kills `window.prompt`

* Proper password/PIN entry used by wallet unlock, encrypted export, and any
  signing-gated action. One component, three invocation points.

### 9.7 Navigation (`App.js`, `Header.js`)

* Routes: `/` Home · `/pay` SendFlow · `/request` RequestFlow ·
  `/p2p` Convert (unchanged P2PExchange) · `/settings` Wallet management.

* Header: wordmark + 4 items max; Scanner/Dashboard tabs removed (Dashboard's
  useful content folds into Home's Activity).

### 9.8 Explicitly out of scope for this phase

* Auto-conversion broker UX (§7.2) — Phase B, after Send/Request ships.

* Push notifications, contact sync, usernames — later; each has privacy
  trade-offs needing its own decision.

* Mainnet switch — §13 Q1.

***

## 10. API Surface — Current and Required

### 10.1 Reused as-is (already built & hardened)

| Endpoint                                                                                                                                                               | Used for                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `POST /api/auth/challenge`, `POST /api/auth/verify`                                                                                                                    | All sessions                                |
| `GET /api/p2p/rate`                                                                                                                                                    | XRP⇄TRY display, Add funds pricing          |
| `POST /api/payment_requests`, `GET /api/payment_requests`                                                                                                              | Request flow                                |
| `GET /api/transactions` (+ `POST` for recording)                                                                                                                       | Activity list                               |
| `POST /api/p2p/quick`-less matching endpoints (`create-order`, `match`, `confirm-payment`, `confirm-xrp`, `prepare-escrow`, `submit-escrow-hash`, `cancel`, `dispute`) | The rail / Convert tab / future broker flow |
| WebSocket order updates                                                                                                                                                | Convert tab live updates                    |

### 10.2 New endpoints required (exactly two)

| Endpoint                                      | Purpose                                                  | Auth                                      | Notes                                                                                                                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/payment_requests/:requestId`        | Sender opening a payment link sees amount/note/recipient | **Public** (link possession = capability) | Returns only: amount\_xrp, to\_address, note, status, expires\_at. No requester metadata beyond the address (already public on-chain). Rate limit aggressively.                                                                                                   |
| `PATCH /api/payment_requests/:requestId/paid` | Mark a request paid after the send settles               | JWT (sender)                              | Body: `{ txHash }`. Server verifies the tx hash format; optionally verifies on-chain that the tx pays `to_address` ≥ `amount_xrp` (recommended — reuse the XRPL verification pattern from `submit-escrow-hash`). Sets `status='paid'`, `paid_tx_hash`, `paid_at`. |

### 10.3 Scheduled jobs required

* **Payment-request expiry/purge** (30 days) — SQL `UPDATE ... WHERE
  created_at < NOW() - INTERVAL '30 days' AND status='pending'` on an interval
  (server `setInterval` is fine at current scale, as with the existing rate
  cache refresh pattern).

* **Order/escrow expiry sweep** — lock/expiry handling for stale matched
  orders and cancellable escrows (fills gap G8; EscrowCancel path already
  exists in `xrplEscrowService`).

***

## 11. Data Model Changes

Minimal by design — two column additions and one index, via a new migration
(`008_payment_request_lifecycle.sql`, following the append-only migration
convention):

```sql
ALTER TABLE payment_requests
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS paid_tx_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days');

CREATE INDEX IF NOT EXISTS idx_payment_requests_request_id
  ON payment_requests (request_id);
```

(DAL: `PaymentRequestsDAL.getByRequestId`, `markPaid`, `expireStale` — three
small methods, parameterized queries, matching existing DAL style.)

No changes to `p2p_orders`, `transactions`, or auth tables for this phase.

***

## 12. Build Order & Milestones

Each milestone is independently shippable and testable.

| #      | Milestone                    | Contents                                                                                                                                               | Depends on                             |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| **M1** | **Home + Send** — SHIPPED 2026-07-28 (build clean; suite at baseline 12F/139F) | `Home`, `SendFlow`, `ConfirmSheet`, `UnlockModal`, navigation rework, Settings sheet                                                                   | Nothing (frontend-only; existing APIs) |
| **M2** | **Request links** — SHIPPED 2026-07-28 (migration 008 NOT needed: schema/DAL already had status/expires_at/markAsPaid; build clean; suite at baseline 12F/139F) | `RequestFlow`, payment-link QR, `GET /api/payment_requests/:requestId` (public), `PATCH …/paid` (JWT + on-chain amount/recipient verification), 30-day expiry on creation, scan-first convergence via `?req=` resolution in SendFlow                                                          | M1 (ConfirmSheet)                      |
| **M3** | **Polish & privacy pass**    | Request expiry job, activity merge, log PII audit, self-host xrpl.js, empty states, mobile QA                                                          | M1–M2                                  |
| **M4** | **Broker on-ramp** (Phase B) | `quick-match` endpoint, Add funds flow, pre-filled Papara instructions, reference-code reconciliation, escrow auto-lock UX for sellers, expiry sweeper | M1–M3 + PRD Phases 5–7 hardening       |
| **M5** | **E2E proof**                | Full-journey tests: create wallet → request → pay link → on-ledger verify; trade loop e2e                                                              | PRD Phase 7                            |

PRD Phases 5–7 (API hardening, test rebuild) continue **in parallel** — they
harden the rail these flows ride on and are not blocked by M1–M3.

***

## 13. Risks & Open Questions

| #  | Question                                                                                                    | Status                          | Notes                                                                                                                                                                                |
| -- | ----------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1 | Testnet → mainnet timing and checklist (reserves, fee config, rate sources, CDN self-hosting, legal review) | **Open — needs owner decision** | Everything above is network-agnostic; the switch is config + a hardening pass.                                                                                                       |
| Q2 | Real Papara production credentials for live fiat-leg verification                                           | **Open — external blocker**     | Until provided, fiat-leg verification is sandbox-level.                                                                                                                              |
| Q3 | Liquidity: who seeds the sell side at launch (operator market-maker budget)?                                | **Open — business decision**    | Broker flow is useful only with sellers present.                                                                                                                                     |
| Q4 | Usernames/contacts (human-readable recipients without links)                                                | Deferred                        | Any server-side username registry is a PII/social-graph store; needs a privacy-preserving design or explicit acceptance of the trade-off. Payment links are the zero-PII substitute. |
| Q5 | Push notifications (order matched, request paid)                                                            | Deferred                        | Web push requires a push service (third party sees device tokens); in-app polling/WebSocket is the private default.                                                                  |
| Q6 | Dispute volume on the fiat leg once real users arrive                                                       | Watch                           | If disputes dominate, consider Papara-reference auto-verification for market-maker trades only.                                                                                      |
| Q7 | Mobile packaging (PWA vs native wrapper)                                                                    | Deferred                        | Design targets mobile-first PWA; native wrapper only if push/camera UX demands it.                                                                                                   |

***

*This document supersedes any earlier product notes. The PRD (`PRD.md`)
remains the source of truth for the production-readiness engineering program
(Phases 1–7); this document is the source of truth for **what the product is
and where the UX is going.***
