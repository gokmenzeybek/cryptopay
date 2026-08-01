# E2E Test Suite Ready

This document details the configuration, execution commands, expected outcomes, and feature coverage matrix for the TRY-XRP P2P Exchange End-to-End (E2E) test suite.

## Execution

### Run Command
To execute the complete E2E test suite, run the following command in the project root:

```bash
npx jest --config jest.e2e.config.js
```

### Expected Exit Codes
- **`0`**: Success. All 60 test cases ran and passed successfully.
- **Non-zero (e.g., `1`)**: Failure. One or more test cases failed.

---

## Coverage Matrix

The E2E test suite covers **60 test cases** across **4 tiers** matching the features specified in `PRD_KEY_TASKS.md` and the actual production API contracts.

| Tier | Focus | Covered Test Cases | Target Features | Status |
| --- | --- | --- | --- | --- |
| **Tier 1** | Feature Coverage (Happy Path) | 25 test cases (F1.1-F1.5, F2.1-F2.5, F3.1-F3.5, F4.1-F4.5, F5.1-F5.5) | F1, F2, F3, F4, F5 | **READY** |
| **Tier 2** | Boundary & Corner Cases | 25 test cases (F1-B1 to F5-B5) | F1, F2, F3, F4, F5 | **READY** |
| **Tier 3** | Cross-Feature Combinations | 5 test cases (F3X1-F3X5) | F1-F5 Integrations | **READY** |
| **Tier 4** | Real-World Scenarios | 5 test cases (F4S1-F4S5) | Multi-step P2P flows | **READY** |

### Feature Reference Map

- **F1: Authentication**
  - **Happy Path (Tier 1)**: Request challenge nonce, verify signature for JWT token issuance, token expiration verification, protected REST endpoint authentication, and WebSocket connection handshake validation.
  - **Boundary Cases (Tier 2)**: Invalid XRPL address format check, mismatched derived address signature check, invalid signature verification check, unauthorized request block, and malformed JWT token handling.

- **F2: Papara Webhooks & Order State Transitions**
  - **Happy Path (Tier 1)**: HMAC-verified payment webhooks, automatic transitions to MATCHED status, payment confirmation transitions, confirmed XRP transitions, and payment method options lookup.
  - **Boundary Cases (Tier 2)**: Webhook with invalid signature, webhook with non-existent reference ID, webhook with mismatched amount, duplicate payment confirmation prevention, and payment confirmation on cancelled orders.

- **F3: WebSockets Real-Time Updates & Chat**
  - **Happy Path (Tier 1)**: Broadcast updates to rooms, matched update broadcasts to buyer/seller, real-time message broadcasting, database persistence of trade chats in order metadata, and payment status update broadcasts.
  - **Boundary Cases (Tier 2)**: WebSocket unauthorized connection block, chat room access blocking for non-participants, chat messaging block for unjoined rooms, empty chat message validation, and socket throttling.

- **F4: XRPL Escrow Interactions**
  - **Happy Path (Tier 1)**: Escrow preparation JSON creation, escrow transaction hash submission, escrow lock status verification, escrow cancel before match, and escrow dispute refunding.
  - **Boundary Cases (Tier 2)**: Negative escrow amount validation, invalid XRPL destination address check, invalid transaction hash format check, confirm payment on non-matched order block, and double refund/release prevention.

- **F5: Dispute Resolution**
  - **Happy Path (Tier 1)**: Join socket room, send chat messages, raise dispute with reason, moderator list disputes, and moderator resolve dispute.
  - **Boundary Cases (Tier 2)**: Dispute without reason block, dispute by non-participant block, dispute resolution on non-disputed order block, duplicate dispute prevention, and XSS sanitization in evidence.
