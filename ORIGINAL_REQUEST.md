# Original User Request

## Initial Request — 2026-06-04T03:35:59+03:00

Implement the first 6 core tasks to make the CryptoPay TRY-XRP P2P exchange production-ready.

Working directory: /Users/enesgokmenzeybek/paymentfinal/xrpl-dev-portal/cryptoPay
Integrity mode: development

## Requirements

### R1. Authentication System
Implement a secure user registration, login, logout, and session maintenance system. All client actions on the P2P marketplace must be associated with authenticated user sessions.

### R2. Production-Ready Papara Integration
Replace the sandbox/mock Papara client with production API integration. Implement support for receiving instant transfer webhooks, verifying payment authenticity via signatures, and automatically transitioning order states.

### R3. WebSocket Real-Time Updates
Create a real-time event-broadcasting layer using WebSockets. Broadcast marketplace order updates, user matching status, payment confirmations, and chat messages immediately to active clients.

### R4. Escrow System for XRP
Integrate XRPL-native escrow functionality into P2P trades. When orders are matched, XRP must be automatically locked in escrow on the XRPL Testnet, and released or refunded depending on payment status or disputes.

### R5. Chat and Dispute Resolution
Implement a direct chat interface between buyers and sellers who are actively matched in a trade. Include a workflow for moderators to inspect disputed orders and release/cancel the locked escrow.

## Verification Resources
- Existing Jest testing framework configured in `package.json`.
- Main server file: server.production.js.
- Database schema: schema.sql.

## Acceptance Criteria

### Authentication & Sessions
- [ ] Users can register with a unique username/email and login with secure credentials.
- [ ] Session tokens protect sensitive REST and WebSocket connections, returning HTTP 401/403 for unauthorized requests.

### Papara Payment Webhooks
- [ ] Incoming webhook payloads from Papara verify cryptographic signatures.
- [ ] Orders matched for Papara transfers transition state automatically upon webhook verification.

### Real-Time Updates
- [ ] Frontend order listings, chat logs, and status updates refresh instantly in the browser without reloading the page.

### XRPL Escrow Verification
- [ ] Matching a trade calls the XRPL Testnet to lock XRP in escrow.
- [ ] Confirming payment releases XRP to the buyer; disputing or expiring releases/refunds it appropriately.

### Automated Tests
- [ ] At least 90% of code paths in new controllers/services have passing Jest unit/integration tests.
