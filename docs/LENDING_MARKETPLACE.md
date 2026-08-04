# Lending Marketplace — Platform as the XRP Reserve

This document defines how CryptoPay acts as an **XRP liquidity reserve** that
lends to sellers, clears TRY through the platform, and charges a **2.5% cut on
TRY**. It complements `P2P_TRY_API_GUIDE.md` / `FIAT_TO_XRP_API_GUIDE.md` / the
existing escrow flow in `services/xrplEscrowService.js`.

> Status: design + scaffold. The Papara rails are **mock/sandbox** today; the
> cut is only ever settled **in TRY** via Papara (see *Papara* below).

## Business model at a glance

```
        ┌───────────  platform = XRP reserve  ───────────┐
        │                                                 │
   lends XRP           escrows XRP (lend)                │
        │                    │                            │
        ▼                    ▼                            │
   SELLER            BUYER ← reserve escrow (delivered     │
    (merchant)               only after TRY clears)       │
        ▲                       ▲                         │
        └───── TRY (net of 2.5%) ─┘                       │
                   buyer pays TRY ──────────────> platform│
                                                    (cut) │
        └─────────────────────────────────────────────────┘
```

- **Platform** is the XRP reserve. It **lends XRP** to the seller (represented
  as reserve escrows, *not* wallet transfers).
- **Seller** markets a reserve-backed fill (up to an approved credit limit).
- **Buyer** buys XRP, paying **TRY to the platform** (never the seller).
- On confirmed TRY, the platform **releases XRP to the buyer**.
- The platform keeps a **2.5% cut on TRY**, pays the seller net TRY ASAP, and
  the **XRP returns to the reserve** (lent amount reconciled at settlement).

---

## The cut

- **Basis:** TRY proceeds (`gross_try`).
- **Rate:** `RESERVE_CUT_PERCENT` (decimal), default `0.025` (2.5%).
- **This is the only cut option.** There is no XRP-basis fee and no other fee
  tier; adding one requires a schema + service change.

Formula (see `services/lendingService.js` → `computeCut`):

```
cutTry          = round2( grossTry - sellerPayoutTry )      # 2.5% rounded
sellerPayoutTry = round2( grossTry * (1 - cutPercent) )     # net to seller
```

**Example:** buyer buys 100 XRP at ₺30/XRP → `grossTry = ₺3,000`.
`cutTry = ₺75`, `sellerPayoutTry = ₺2,925`.

---

## 2. Settlement rail (mandatory): buyer → platform

TRY **must** clear through the platform treasury (not direct seller-to-buyer).
This is the *only* supported rail because it lets the platform (a) verify
payment before releasing XRP and (b) keep its cut before payout, making the
2.5% **structurally safe**.

Order of operations on a trade:

1. `POST /api/p2p/create-order` → seller creates a reserve-backed order
   (   credit granted via `reserve_credit`).
2. `POST /api/p2p/match` → matched.
3. `POST /api/p2p/prepare-escrow` → **escrow `source` = reserve address**
   (lend); `destination` = buyer; preimage held server-side.
4. Buyer pays TRY to platform (Papara). The HMAC-verified webhook
   `POST /api/webhooks/papara` confirms funds.
5. `POST /api/p2p/confirm-payment` → order = `payment_confirmed`.
6. `POST /api/p2p/confirm-escrow-completion` → reveal preimage, `EscrowFinish`
   releases XRP reserve → **buyer**.
7. `POST /api/p2p/settle` (idempotent, internal) → computes cut, marks
   `reserve_settlements`, reconciles outstanding lend, triggers Papara payout
   to the seller's Papara account.

If the buyer never pays before `CancelAfter`, the escrow auto-returns XRP to
the reserve and the order is voided (no cut).

---

## 3. Security model (why this is safe)

| Risk | Control |
|------|---------|
| Seller runs with borrowed XRP | Loaned XRP never touching the seller’s wallet; escrow `Account` = reserve, `Destination` = buyer |
| Buyer runs without paying | XRP only released on HMAC-confirmed TRY |
| Platform loses the cut | TRY clears through the platform; cut taken before seller payout |
| Reserve locked forever on no-show | `CancelAfter` auto-returns escrow to reserve |

The escrow is still prepared with a per-trade preimage and released only inside
`EscrowFinish`. The server **never holds wallet seeds** beyond the ops/escrow
reserve account (prepared server-side, signed client-side), consistent with the
rest of the app.

---

## 5. Configuration

| Env | Default | Meaning |
|-----|---------|---------|
| `RESERVE_ADDRESS` | unset (reserve path **disabled**) | XRP reserve account that funds/lends escrows |
| `RESERVE_CUT_PERCENT` | `0.025` | Platform cut on TRY |
| Papara key/environment | (existing) | TRY settlement rail |

> **Opt-in.** When `RESERVE_ADDRESS` is unset the app keeps the legacy
> seller-sourced escrow and records no cut — production is unaffected until the
> reserve is configured. This mirrors the `SPONSOR_SEED` / lazy-Redis pattern.

---

## 6. Papara (mock → live)

Everything on the TRY side is **mock/sandbox** today. When wired to live Papara:

- the buyer’s TRY to the platform and the **seller payout (net of cut)** both go
  through `PaparaService` (`services/paparaService.js`);
- the webhook `POST /api/webhooks/papara` (HMAC) authorizes the XRP release and
  records the cut.

Nothing in this design blocks on a live Papara key; settlement is recorded
idempotently (`reserve_settlements.status = 'pending'`) so the real payout can
be replayed when Papara is connected.

---

## 7. Migration

`database/migrations/013_lending_settlement.sql` adds:

- `p2p_orders.escrow_source` — reserve vs. seller (trust ledger for the lend)
- `p2p_orders.lent_xrp` — XRP lent from the reserve for the trade
- `p2p_orders.settlement_status` / `cut_try` / `gross_try` / `seller_payout_try` / `settled_at`
- `reserve_credit` — per-seller XRP lending limits + outstanding
- `reserve_settlements` — immutable audit log of each cut/payout

## 8. Service & route

`services/lendingService.js` exposes `computeCut`, `authorizeLend`,
`reserveLend`, `releaseLend`, `escrowSource`, `recordSettlement`. The route
`POST /api/p2p/settle` is wired in `server.production.js`.