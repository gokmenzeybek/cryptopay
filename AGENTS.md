# AGENTS.md — CryptoPay

This file gives AI coding agents a complete orientation to this repository. It assumes no prior knowledge of the project.

## Project Overview

**CryptoPay (v3.0.0)** is an XRPL (XRP Ledger) payment application with a peer-to-peer Turkish Lira (TRY) ↔ XRP exchange. It consists of:

- **Backend**: Express.js REST API + WebSocket server, PostgreSQL persistence, running on **port 5001** (bound to `0.0.0.0` for LAN access).
- **Frontend**: React 18 single-page app (Create React App / react-scripts 5), built into `build/` and served as static files by the Express server.
- **XRPL integration**: Operates against the XRPL **testnet** (`wss://s.altnet.rippletest.net:51233`). Frontend loads `xrpl.js` via CDN (`window.xrpl`); backend uses the `xrpl` npm package for escrow preparation.
- **Key features**: wallet creation/funding, XRP payments, QR payment requests, P2P order book with matching, Papara instant-transfer integration (with HMAC-verified webhooks), XRPL escrow locking for trades ("prepare & record" mode — the server never holds seeds), dispute resolution with a moderator API, JWT auth based on XRPL keypair challenge/verify signatures.

There are no third-party fiat on-ramps (Stripe/PayPal/MoonPay); TRY movement happens via Turkish payment methods (Bank Transfer, Papara, İninal, Mefete, QR Havale) between peers.

## Entry Points & Which Server Is Real

- `server.production.js` (~1670 lines) — **the primary server**. Used by `npm start`, `npm run prod`, and PM2 (`ecosystem.config.js`). Includes security middleware, auth, escrow, Papara webhook, and moderator endpoints.
- `server.js` (~1330 lines) — lighter development server used by `npm run dev` (nodemon). **Note:** the production `Dockerfile` `CMD`s `node server.js`, which diverges from `npm start`/`ecosystem.config.js` — be aware of this when changing startup behavior.
- `app.js` and `server.js.backup` — **legacy, unused**. `app.js` is an old vanilla-JS/SQL.js implementation kept for reference only. Do not modify unless explicitly asked.
- `test_api.js`, `test_p2p_api.js`, `repro3.js`, `generate_test_addresses.js` — standalone node scripts for manual API testing/scratch work, not part of the Jest suite.

## Technology Stack

- **Runtime**: Node.js >= 16 (Docker images use `node:18-alpine`).
- **Backend**: Express 4, `pg` (PostgreSQL 15), `ws` (WebSocket), `jsonwebtoken`, `ripple-keypairs`, `xrpl`, `helmet`, `express-rate-limit`, `express-validator`, `compression`, `morgan`, `winston` (logging), `dotenv`. Papara via `@papara/papara` SDK.
- **Frontend**: React 18, react-router-dom v6, styled-components, react-toastify, axios, `@yudiel/react-qr-scanner`, `qrcode`.
- **Testing**: Jest 29, babel-jest, supertest, @testing-library/react + jest-dom, jest-environment-jsdom.
- **Infra**: Docker multi-stage build, docker-compose (app + PostgreSQL, optional nginx/redis profiles), PM2 (`ecosystem.config.js`, cluster mode), nginx reverse proxy config (`nginx.conf`).

## Build and Run Commands

```bash
npm install              # install dependencies
npm run db:migrate       # apply database schema + migrations (needs PostgreSQL)
npm run build            # build React frontend into build/ (required before serving)
npm start                # production server (node server.production.js)
npm run dev              # dev server with nodemon (server.js)
npm run lint             # eslint src/ server*.js middleware/ services/ database/
npm run health           # curl http://localhost:5001/api/health
```

Setup: copy `.env.example` to `.env` and fill in values. Key variables: `POSTGRES_HOST/PORT/DB/USER/PASSWORD`, `PORT` (5001), `JWT_SECRET`, `XRPL_TESTNET_URL`, `PAPARA_API_KEY`/`PAPARA_ENVIRONMENT`/`PAPARA_MERCHANT_ID`, `PAPARA_WEBHOOK_SECRET`, `MODERATOR_API_KEY`, rate-limit knobs (`RATE_LIMIT_*`), `RATE_CACHE_TTL_SECONDS` (default 300).

### Docker / Deployment

```bash
docker-compose up --build          # app + postgres
docker-compose up -d               # background
npm run docker:build / docker:run  # direct docker commands
npm run pm2:start                  # PM2 single-instance mode via ecosystem.config.js
```

The `Dockerfile` is a 3-stage build: (1) build React frontend, (2) install prod backend deps, (3) runtime as non-root user `cryptopay` with dumb-init, health check on `/api/health`. `docker-compose.yml` wires in PostgreSQL 15 (schema auto-loaded from `database/schema.sql`) and offers `nginx` and `redis` profiles.

## Testing Instructions

- `npm test` — runs the full Jest suite (`jest.config.js`): unit + integration tests matching `**/__tests__/**` and `*.test.js`, with **80% global coverage thresholds enforced** (branches/functions/lines/statements). Coverage from `src/`, `services/`, `middleware/`, `server.js`.
- Targeted suites: `npm run test:services`, `test:middleware`, `test:server`, `test:components`, `test:hooks`, `test:unit`.
- `npm run test:coverage` / `test:ci` — coverage / CI variants.
- **E2E**: `jest.e2e.config.js` runs only `tests/e2e/**/*.test.js` (`npx jest --config jest.e2e.config.js`). These boot the real server on **port 5002** with real WebSocket and **require a running PostgreSQL**; they run sequentially (`maxWorkers: 1`) with 30s timeouts. `tests/e2e/setup.js` sets generous rate limits for the suite.
- `npm run test:all` — comprehensive script (`scripts/test-all.sh`): unit tests, coverage, API tests, optional Docker tests.
- `npm run test:api` — standalone script (`node test_api.js`) hitting a live server on 5001; this is **not** Jest.
- Docker-based testing: `docker-compose -f docker-compose.test.yml up test-unit|test-coverage|test-integration` (`npm run test:docker*`).
- See `TESTING.md` for the full testing guide.

Test layout: colocated `__tests__/` directories under `services/`, `middleware/`, `database/`, `server/`, `src/components/`, `src/hooks/`, plus top-level `tests/` (`integration.test.js`, `auth_gaps.test.js`, `e2e/`, shared `setup.js`, and `shims/nodeCrypto.js`).

Jest quirks to know:
- `moduleNameMapper` pins `^crypto$` to `tests/shims/nodeCrypto.js` (forces real Node crypto inside Jest).
- `transformIgnorePatterns` whitelists ESM-only `@noble/` and `@scure/` packages for Babel transform.
- `clearMocks` and `resetModules` are enabled globally; setup file is `tests/setup.js`.

## Code Organization

```
server.production.js / server.js   # Express servers (routes, wiring)
app.js                             # LEGACY — unused, reference only
middleware/                        # security.js (headers, CORS, validators), auth.js (JWT),
                                   # rateLimit.js, errorHandler.js
services/                          # Business logic:
                                   #   p2pMatchingService.js    — order lifecycle, matching, disputes
                                   #   tryRateScraperService.js — XRP/TRY rates scraped from BTCTurk,
                                   #                              Paribu, Binance, CoinGecko (weighted avg, cached)
                                   #   paparaService.js         — Papara API client (sandbox/prod)
                                   #   xrplEscrowService.js     — EscrowCreate/Finish/Cancel tx building
                                   #   xrplConversionService.js, fiatPaymentService.js,
                                   #   exchangeRateService.js, websocketService.js (ws-based order updates)
database/                          # connection.js (pg Pool + health checks), schema.sql,
                                   # migrate.js, migrations/ (003 papara, 004 escrow), dal/ (per-table DALs)
src/                               # React frontend
  App.js, index.js                 # Router setup, entry
  hooks/useXRPL.js                 # XRPLProvider context: client, wallet, tx helpers (loads window.xrpl from CDN)
  components/                      # Wallet, Payment, RequestPayment, QRScanner, Dashboard,
                                   # P2PExchange, OrderBook, OrderForm, OrderDetails,
                                   # PaymentConfirmation, XRPConfirmation, DisputeResolution, Header
  services/p2pApiService.js        # frontend HTTP client for the P2P API
utils/logger.js                    # Winston logger (logs/combined.log, logs/error.log)
monitoring/healthcheck.js          # standalone health-check script
scripts/                           # deploy.sh, test.sh, test-all.sh, docker-*.sh
docs/                              # PAPARA_API_DOCUMENTATION.md, DEPLOYMENT_GUIDE.md
```

Database tables (`database/schema.sql`): `wallets`, `auth_challenges`, `transactions`, `payment_requests`, `p2p_orders`, `p2p_order_matches`, `rate_history`, `system_settings`.

Main API surface (see `server.production.js`): `/api/health`, `/api/auth/challenge` + `/api/auth/verify` (XRPL-signature JWT login), `/api/p2p/*` (rate, payment-methods, create-order, orders, my-orders, match, confirm-payment, confirm-xrp, cancel, dispute, prepare-escrow, submit-escrow-hash, stats), `/api/moderator/*` (dispute listing/resolution, guarded by `MODERATOR_API_KEY` when set), `/api/webhooks/papara` (HMAC-signed), plus core `/api/wallets`, `/api/transactions`, `/api/payment_requests`, `/api/stats`, `/api/export`. Full references: `P2P_TRY_API_GUIDE.md`, `docs/PAPARA_API_DOCUMENTATION.md`, `FIAT_TO_XRP_API_GUIDE.md`.

## Code Style Guidelines

- **Backend is CommonJS** (`require`/`module.exports`), camelCase, heavy JSDoc-style block comments at file and function level. Match this when editing.
- Layered pattern: route handlers in the server file → `services/` for business logic → `database/dal/` for SQL. Keep that separation; don't put SQL in routes or business logic in DALs.
- API responses follow a consistent envelope: `{ success: boolean, ... }` with `error`/`message` fields on failure.
- Errors: async handlers wrapped with `catchAsync` (from `middleware/errorHandler.js`); logging goes through `utils/logger.js` (Winston), never bare `console.log` in server code.
- Validation/requests: `express-validator` plus helpers in `middleware/security.js` (`validateXRPLAddress`, `validateAmount`, `sanitizeInput`, rate limiters).
- **Frontend** is JSX (Babel/React): functional components + hooks only, global XRPL state via the `XRPLProvider` context in `src/hooks/useXRPL.js` (no Redux), styling with styled-components, user feedback via react-toastify. The frontend auto-detects hostname to build the API base URL (localhost vs LAN IP).
- XRPL transaction pattern: prepare → `client.autofill()` → sign → submit → check `engine_result === 'tesSUCCESS'` → wait for ledger validation before treating as complete.

## Security Considerations

- **Never commit `.env`**. It contains `JWT_SECRET`, Postgres credentials, and Papara keys. `.env.example` is the template. There is a hardcoded fallback `JWT_SECRET` in `server.production.js` and `middleware/auth.js` (`fallback_jwt_secret_key_change_me_in_prod`) — always set `JWT_SECRET` in any real environment.
- Auth is JWT issued after an XRPL keypair signature challenge (`/api/auth/challenge` → `/api/auth/verify`); protected routes use `middleware/auth.js`. Moderator endpoints check `x-moderator-key` against `MODERATOR_API_KEY` (open when unset — dev/test only).
- The Papara webhook (`/api/webhooks/papara`) verifies an HMAC signature with `PAPARA_WEBHOOK_SECRET`; don't bypass this.
- The server **never holds wallet seeds**; escrow transactions are prepared server-side but signed client-side.
- Security stack: helmet headers, configurable CORS, `express-rate-limit` tiers, input sanitization, `trust proxy` is set (be careful with IP-based logic behind proxies).
- The app targets the **XRPL testnet** by default; check `XRPL_NETWORK`/`XRPL_*_URL` env vars before assuming mainnet behavior.

## Repository Housekeeping

- `logs/`, `coverage/`, `build/` are generated artifacts.
- `.agents/` contains artifacts from previous AI-agent runs (briefings, progress notes) — it is not source code; ignore it unless researching prior work.
- Several top-level docs overlap in content and age: `CLAUDE.md` (Claude-specific guidance, partially outdated — e.g., it predates Papara/escrow/auth), `README.md` (Papara-focused quick start), `README_PRODUCTION.md`, `PRODUCTION_DEPLOYMENT.md`, `DOCKER_DEPLOYMENT.md`, `REFACTOR_PLAN.md`, `TESTING.md`, `TEST_READY.md`. When changing architecture, prefer updating `AGENTS.md` and the relevant guide under `docs/`.
- Known doc/code drift to keep in mind: Dockerfile runs `server.js` while `npm start`/PM2 run `server.production.js`; `README.md` mentions port 3000 but the app actually serves on 5001; `db:seed` script references a `database/seed.js` that does not exist.
