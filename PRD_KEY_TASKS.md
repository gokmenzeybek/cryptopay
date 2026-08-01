# CryptoPay - Product Requirements Document (PRD)
## Key Implementation Tasks

**Version:** 1.0  
**Date:** October 25, 2025  
**Status:** Draft - Awaiting Clarification

---

## Overview

This document outlines the critical features that need to be implemented to make CryptoPay production-ready. Each key task is broken down into 20 simple, actionable subtasks that can be understood and implemented by any developer or LLM.

---

## 🔐 KEY TASK 1: Authentication System

**Goal:** Create a secure user authentication system so users can log in, register, and maintain sessions.

### Subtasks:

1. Create a `users` table in PostgreSQL database with columns: id, username, email, password_hash, created_at, updated_at
2. Install bcrypt package for password hashing: `npm install bcrypt`
3. Install jsonwebtoken package for JWT tokens: `npm install jsonwebtoken`
4. Create a new file `database/dal/users.js` for user database operations
5. Add a function in users.js to create a new user with hashed password
6. Add a function in users.js to find a user by email address
7. Add a function in users.js to find a user by username
8. Add a function in users.js to update user's last login timestamp
9. Create a new file `middleware/auth.js` for authentication middleware
10. In auth.js, create a function to generate JWT token with user id and email
11. In auth.js, create a function to verify JWT token from request headers
12. In auth.js, create middleware to protect routes (check if token is valid)
13. Create a new file `server/authRoutes.js` for authentication endpoints
14. In authRoutes.js, create POST `/api/auth/register` endpoint to register new users
15. In authRoutes.js, create POST `/api/auth/login` endpoint to login users
16. In authRoutes.js, create POST `/api/auth/logout` endpoint to logout users
17. In authRoutes.js, create GET `/api/auth/me` endpoint to get current user info
18. Add the auth middleware to protected routes like `/api/wallets`, `/api/p2p/create-order`
19. Store JWT_SECRET in .env file for token signing
20. Test all authentication endpoints with curl or Postman

---

## 💳 KEY TASK 2: Real Papara Integration (Production-Ready)

**Goal:** Replace sandbox/mock Papara integration with real API calls to process actual TRY payments.

### Subtasks:

1. Sign up for a real Papara merchant account at https://merchant.papara.com
2. Complete Papara merchant verification process (submit business documents)
3. Get production API key from Papara merchant dashboard
4. Get production Merchant ID from Papara merchant dashboard
5. Add production API key to .env file as `PAPARA_API_KEY=your_real_key`
6. Add Merchant ID to .env file as `PAPARA_MERCHANT_ID=your_merchant_id`
7. Change `PAPARA_ENVIRONMENT=production` in .env file
8. Open `services/paparaService.js` and verify client initialization uses production environment
9. Test `validateAccount` function with a real Papara account number
10. Test `sendPayment` function with a small real amount (like 1 TRY)
11. Create a new file `server/webhookRoutes.js` for Papara webhooks
12. In webhookRoutes.js, create POST `/api/webhooks/papara` endpoint to receive payment notifications
13. In webhook endpoint, verify Papara signature to ensure request is authentic
14. In webhook endpoint, update order status when payment is completed
15. In webhook endpoint, update order status when payment fails
16. Configure webhook URL in Papara merchant dashboard to point to your server
17. Test webhook by making a real payment and checking if order updates
18. Add error handling for failed Papara API calls (retry logic)
19. Add logging for all Papara API requests and responses
20. Create admin dashboard endpoint to view Papara transaction history

---

## 🔴 KEY TASK 3: WebSocket Real-Time Updates

**Goal:** Add WebSocket server so users see order updates, payments, and matches in real-time without refreshing.

### Subtasks:

1. Install socket.io package: `npm install socket.io`
2. Install socket.io-client for frontend: `npm install socket.io-client`
3. Open `server.js` and import socket.io at the top
4. Initialize socket.io server with Express app: `const io = require('socket.io')(server)`
5. Create a new file `server/socketHandlers.js` for WebSocket logic
6. In socketHandlers.js, create function to handle new client connections
7. In socketHandlers.js, create function to handle client disconnections
8. In socketHandlers.js, create function to join a room based on order ID
9. In socketHandlers.js, create function to emit "orderCreated" event to all clients
10. In socketHandlers.js, create function to emit "orderMatched" event to specific room
11. In socketHandlers.js, create function to emit "paymentConfirmed" event to specific room
12. In socketHandlers.js, create function to emit "orderCompleted" event to specific room
13. In socketHandlers.js, create function to emit "newMessage" event for chat
14. Update `/api/p2p/create-order` endpoint to emit WebSocket event after order creation
15. Update `/api/p2p/match` endpoint to emit WebSocket event after matching
16. Update `/api/p2p/confirm-payment` endpoint to emit WebSocket event
17. In frontend, create `src/hooks/useWebSocket.js` hook to connect to WebSocket
18. In useWebSocket.js, add listeners for "orderCreated", "orderMatched", "paymentConfirmed"
19. Update P2PExchange.js component to use WebSocket hook and auto-refresh on events
20. Test by opening two browser windows and creating/matching orders to see real-time updates

---

## 🔒 KEY TASK 4: Escrow System for XRP

**Goal:** Hold XRP in escrow during P2P trades to protect both buyer and seller until trade completes.

### Subtasks:

1. Research XRPL Escrow functionality at https://xrpl.org/escrow.html
2. Create a new file `services/xrplEscrowService.js` for escrow operations
3. In xrplEscrowService.js, import xrpl library: `const xrpl = require('xrpl')`
4. Create function `createEscrow(amount, destination, finishAfter)` to create escrow transaction
5. Create function `finishEscrow(escrowId, fulfillment)` to release escrow funds
6. Create function `cancelEscrow(escrowId)` to cancel escrow if trade fails
7. Add `escrow_sequence` column to `p2p_orders` table to store escrow identifier
8. Add `escrow_created_at` column to `p2p_orders` table
9. Add `escrow_finished_at` column to `p2p_orders` table
10. Update `/api/p2p/match` endpoint to create escrow when orders are matched
11. When creating escrow, set finish time to 2 hours from now (trade deadline)
12. Save escrow sequence number to matched order in database
13. Update `/api/p2p/confirm-xrp` endpoint to finish escrow instead of direct transfer
14. Generate escrow fulfillment from payment reference (use crypto.createHash)
15. In dispute case, create admin endpoint to cancel escrow and refund
16. Add function to automatically cancel expired escrows after 24 hours
17. Create cron job or scheduled task to run escrow cleanup daily
18. Add escrow status field to order details: "created", "finished", "cancelled"
19. Update frontend OrderDetails component to show escrow status
20. Test escrow flow end-to-end with testnet XRP

---

## ⚖️ KEY TASK 5: Dispute Resolution Workflow

**Goal:** Create a complete system for moderators to review and resolve disputes between traders.

### Subtasks:

1. Create `disputes` table in database with columns: id, order_id, raised_by, reason, status, created_at
2. Create `dispute_messages` table with columns: id, dispute_id, user_id, message, image_url, created_at
3. Create `dispute_resolutions` table with columns: id, dispute_id, resolved_by, resolution, resolved_at
4. Add "moderator" role to users table (add `role` column with values: user, moderator, admin)
5. Create file `database/dal/disputes.js` for dispute database operations
6. Add function to create a new dispute record in database
7. Add function to get all open disputes (for moderator dashboard)
8. Add function to get dispute messages and evidence
9. Add function to add a new message to a dispute
10. Add function to resolve a dispute with outcome
11. Create file `server/disputeRoutes.js` for dispute endpoints
12. Create POST `/api/disputes/create` endpoint to raise a dispute
13. Create GET `/api/disputes` endpoint to list all disputes (moderator only)
14. Create GET `/api/disputes/:id` endpoint to get dispute details
15. Create POST `/api/disputes/:id/message` endpoint to add message to dispute
16. Create POST `/api/disputes/:id/resolve` endpoint to resolve dispute (moderator only)
17. Create POST `/api/disputes/:id/evidence` endpoint to upload evidence images
18. Use multer package for image uploads: `npm install multer`
19. Create frontend component `DisputeModeratorDashboard.js` for moderators
20. Test dispute flow: user raises dispute → moderator reviews → moderator resolves

---

## 💬 KEY TASK 6: Chat Between Traders

**Goal:** Allow buyer and seller to chat during a trade to coordinate payment details.

### Subtasks:

1. Create `chat_rooms` table in database with columns: id, order_id, created_at
2. Create `chat_messages` table with columns: id, room_id, sender_address, message, created_at, is_read
3. Create file `database/dal/chat.js` for chat database operations
4. Add function to create a chat room when orders are matched
5. Add function to get all messages for a chat room
6. Add function to send a new message to a chat room
7. Add function to mark messages as read
8. Add function to get unread message count for a user
9. Create file `server/chatRoutes.js` for chat endpoints
10. Create POST `/api/chat/send` endpoint to send a message
11. Create GET `/api/chat/:orderId/messages` endpoint to get messages for an order
12. Create POST `/api/chat/:orderId/read` endpoint to mark messages as read
13. In `server/socketHandlers.js`, add WebSocket event for new chat messages
14. Emit "newMessage" event to both users in the trade when message is sent
15. Create frontend component `TradeChatBox.js` for chat interface
16. In TradeChatBox.js, display all messages in a scrollable list
17. In TradeChatBox.js, add text input and send button
18. Connect TradeChatBox to WebSocket to receive messages in real-time
19. Show unread message badge on OrderDetails component
20. Test chat by having two users send messages back and forth

---

## 📋 KEY TASK 7: KYC/AML Compliance

**Goal:** Add identity verification to comply with financial regulations and prevent fraud.

### Subtasks:

1. Create `kyc_submissions` table with columns: id, user_id, status, submitted_at, reviewed_at, reviewer_id
2. Create `kyc_documents` table with columns: id, submission_id, document_type, file_path, uploaded_at
3. Add `kyc_status` column to users table with values: "not_submitted", "pending", "approved", "rejected"
4. Add `kyc_level` column to users table with values: 1, 2, 3 (different verification levels)
5. Create file `database/dal/kyc.js` for KYC database operations
6. Add function to create a new KYC submission
7. Add function to upload KYC documents (ID card, selfie, proof of address)
8. Add function to get KYC submission details
9. Add function to approve or reject KYC submission (admin only)
10. Install multer and multer-s3 for secure file uploads: `npm install multer multer-s3 aws-sdk`
11. Create file `server/kycRoutes.js` for KYC endpoints
12. Create POST `/api/kyc/submit` endpoint to start KYC process
13. Create POST `/api/kyc/upload-document` endpoint to upload ID documents
14. Create GET `/api/kyc/status` endpoint to check KYC status
15. Create GET `/api/kyc/submissions` endpoint to list all submissions (admin only)
16. Create POST `/api/kyc/:id/review` endpoint to approve/reject (admin only)
17. Add KYC checks to order creation: limit order amounts based on KYC level
18. Level 1 (not verified): max 100 XRP per order
19. Level 2 (basic KYC): max 1000 XRP per order
20. Level 3 (full KYC): no limit
21. Create frontend component `KYCVerification.js` for users to submit documents
22. Create frontend component `KYCReviewDashboard.js` for admins to review submissions

---

## 🤖 KEY TASK 8: Automated Order Matching

**Goal:** Automatically match compatible buy and sell orders instead of manual matching.

### Subtasks:

1. Create file `services/autoMatchingService.js` for automatic matching logic
2. Create function `findBestMatch(order, allOrders)` to find most compatible order
3. Matching criteria: opposite type (buy vs sell), similar rate (+/- 2%), similar amount
4. Prioritize matches with better rates for the user
5. Prioritize matches with users who have high ratings
6. Create function `executeMatch(orderA, orderB)` to automatically match two orders
7. Create function `startAutoMatcher()` that runs every 30 seconds
8. In startAutoMatcher, get all open orders from database
9. For each open buy order, try to find a matching sell order
10. If match found, call executeMatch automatically
11. Send notification to both users when auto-match happens
12. Add `auto_match_enabled` setting to system_settings table
13. Create admin endpoint to enable/disable auto-matching
14. Create endpoint GET `/api/p2p/matching-stats` to show auto-match success rate
15. Add `match_type` column to p2p_orders: "manual" or "automatic"
16. Track matching statistics: total attempts, successful matches, failed matches
17. Add retry logic if match fails (try again after 1 minute)
18. Create notification system to alert users of auto-matches
19. In frontend, add toggle button for users to enable/disable auto-match for their orders
20. Test by creating multiple orders and verifying they match automatically

---

## 🔔 KEY TASK 9: Notification System

**Goal:** Send notifications to users for important events via email, SMS, and in-app notifications.

### Subtasks:

1. Create `notifications` table with columns: id, user_id, type, title, message, is_read, created_at
2. Install nodemailer for emails: `npm install nodemailer`
3. Install twilio for SMS: `npm install twilio`
4. Create file `services/notificationService.js` for notification logic
5. In notificationService.js, create function `sendEmail(to, subject, body)`
6. In notificationService.js, create function `sendSMS(phoneNumber, message)`
7. In notificationService.js, create function `createInAppNotification(userId, title, message)`
8. Configure email SMTP settings in .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
9. Configure Twilio settings in .env (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE)
10. Create notification templates for common events in `templates/notifications/`
11. Template 1: "Order matched" - notify both buyer and seller
12. Template 2: "Payment received" - notify seller
13. Template 3: "XRP sent" - notify buyer
14. Template 4: "Trade completed" - notify both parties
15. Template 5: "Dispute raised" - notify moderators
16. Create file `server/notificationRoutes.js` for notification endpoints
17. Create GET `/api/notifications` endpoint to get user's notifications
18. Create POST `/api/notifications/:id/read` endpoint to mark notification as read
19. Create POST `/api/notifications/preferences` endpoint to update notification preferences
20. Add notification triggers to all key events (order match, payment, completion)
21. In frontend, create NotificationBell component showing unread count
22. Test by creating a trade and verifying emails and in-app notifications are sent

---

## 📊 KEY TASK 10: Analytics Dashboard

**Goal:** Create admin dashboard showing business metrics, user activity, and system health.

### Subtasks:

1. Create file `services/analyticsService.js` for analytics calculations
2. Create function to calculate total trading volume (TRY and XRP) per day
3. Create function to calculate number of active users per day
4. Create function to calculate average order completion time
5. Create function to calculate success rate (completed orders / total orders)
6. Create function to get top traders by volume
7. Create function to track revenue from fees
8. Create `analytics_daily` table to store daily aggregated statistics
9. Create scheduled job to calculate and store daily analytics every midnight
10. Install node-cron for scheduling: `npm install node-cron`
11. Create file `server/analyticsRoutes.js` for analytics endpoints
12. Create GET `/api/analytics/overview` endpoint for dashboard summary
13. Create GET `/api/analytics/volume` endpoint for trading volume over time
14. Create GET `/api/analytics/users` endpoint for user growth metrics
15. Create GET `/api/analytics/orders` endpoint for order statistics
16. Create GET `/api/analytics/revenue` endpoint for fee revenue
17. Require admin role for all analytics endpoints
18. Install chart.js for frontend charts: `npm install chart.js react-chartjs-2`
19. Create frontend component `AdminDashboard.js` with charts
20. In AdminDashboard.js, show line chart for trading volume
21. In AdminDashboard.js, show pie chart for order status distribution
22. In AdminDashboard.js, show table of top traders
23. Test by generating sample data and viewing dashboard

---

## 🔐 KEY TASK 11: Two-Factor Authentication (2FA)

**Goal:** Add extra security layer with 2FA using authenticator apps like Google Authenticator.

### Subtasks:

1. Install speakeasy package for TOTP: `npm install speakeasy`
2. Install qrcode package: `npm install qrcode` (already installed)
3. Add `two_factor_secret` column to users table
4. Add `two_factor_enabled` column to users table (boolean)
5. Create file `services/twoFactorService.js` for 2FA logic
6. In twoFactorService.js, create function `generateSecret(username)` to create 2FA secret
7. In twoFactorService.js, create function `generateQRCode(secret)` to create setup QR code
8. In twoFactorService.js, create function `verifyToken(secret, token)` to verify 6-digit code
9. Create POST `/api/auth/2fa/setup` endpoint to generate 2FA secret and QR code
10. Create POST `/api/auth/2fa/enable` endpoint to enable 2FA after verifying token
11. Create POST `/api/auth/2fa/verify` endpoint to verify 2FA token during login
12. Create POST `/api/auth/2fa/disable` endpoint to disable 2FA
13. Update login endpoint to check if 2FA is enabled for user
14. If 2FA enabled, require token verification before issuing JWT
15. Generate backup codes when 2FA is enabled (10 single-use codes)
16. Store backup codes in `two_factor_backup_codes` table
17. Create endpoint to use backup code if user loses authenticator
18. Create frontend component `TwoFactorSetup.js` showing QR code for setup
19. Create frontend component `TwoFactorVerify.js` for entering 6-digit code
20. Test 2FA flow: setup → scan QR → verify code → login with 2FA

---

## 📱 KEY TASK 12: Mobile App (React Native)

**Goal:** Create native mobile apps for iOS and Android using React Native.

### Subtasks:

1. Install React Native CLI: `npm install -g react-native-cli`
2. Create new React Native project: `react-native init CryptoPayMobile`
3. Install navigation library: `npm install @react-navigation/native`
4. Install required dependencies: `npm install react-native-screens react-native-safe-area-context`
5. Copy business logic from web app to mobile app (API calls, state management)
6. Create mobile version of Login screen
7. Create mobile version of Wallet screen
8. Create mobile version of P2P Exchange screen
9. Create mobile version of Order Book screen
10. Create mobile version of Chat screen
11. Install QR code scanner: `npm install react-native-camera`
12. Implement QR code scanning for payment requests
13. Install push notifications: `npm install @react-native-firebase/messaging`
14. Configure Firebase for push notifications (iOS and Android)
15. Add push notification handling in app
16. Optimize UI for mobile screens (smaller text, larger buttons)
17. Add biometric authentication: `npm install react-native-biometrics`
18. Implement Face ID / Touch ID for login
19. Test app on iOS simulator
20. Test app on Android emulator
21. Build APK for Android: `cd android && ./gradlew assembleRelease`
22. Build IPA for iOS using Xcode

---

## 🌍 KEY TASK 13: Internationalization (i18n)

**Goal:** Support multiple languages (Turkish, English, Spanish, etc.)

### Subtasks:

1. Install i18next: `npm install i18next react-i18next`
2. Create folder `src/locales/` for translation files
3. Create file `src/locales/en.json` for English translations
4. Create file `src/locales/tr.json` for Turkish translations
5. In en.json, add translations for all UI text (buttons, labels, messages)
6. In tr.json, add Turkish translations for all UI text
7. Create file `src/i18n.js` to configure i18next
8. Import and initialize i18n in main App.js
9. Replace all hardcoded text with translation keys: `{t('common.create_order')}`
10. Create language switcher component in header
11. Store selected language in localStorage
12. Load saved language preference on app startup
13. Format dates according to locale (use date-fns/locale)
14. Format numbers according to locale (currency, decimals)
15. Support RTL (right-to-left) languages if needed
16. Translate email templates to multiple languages
17. Translate SMS templates to multiple languages
18. Add language parameter to API responses for dynamic content
19. Create translation guide document for adding new languages
20. Test app by switching between languages and verifying all text translates

---

## 🔍 KEY TASK 14: Advanced Search and Filtering

**Goal:** Allow users to search and filter orders by multiple criteria.

### Subtasks:

1. Add search bar to Order Book component
2. Create function to filter orders by payment method
3. Create function to filter orders by minimum amount
4. Create function to filter orders by maximum amount
5. Create function to filter orders by rate range
6. Create dropdown to filter by order status (open, matched, completed)
7. Create dropdown to filter by order type (buy, sell)
8. Add date range picker to filter orders by creation date
9. Create function to search orders by XRPL address
10. Add sorting options: sort by rate (low to high, high to low)
11. Add sorting options: sort by amount (low to high, high to low)
12. Add sorting options: sort by creation date (newest, oldest)
13. Save filter preferences in localStorage
14. Apply saved filters on page load
15. Add "Clear all filters" button
16. Show active filter count badge
17. Update URL query parameters when filters change
18. Parse URL query parameters on page load to apply filters
19. Add debounce to search input (wait 500ms before filtering)
20. Test all filter combinations to ensure they work correctly

---

## 🏦 KEY TASK 15: Bank Account Verification

**Goal:** Verify user bank accounts for secure TRY transfers.

### Subtasks:

1. Create `bank_accounts` table with columns: id, user_id, bank_name, account_number, iban, owner_name, verified, created_at
2. Create file `database/dal/bankAccounts.js` for bank account operations
3. Add function to add a new bank account
4. Add function to get all bank accounts for a user
5. Add function to verify a bank account
6. Create file `services/bankVerificationService.js` for verification logic
7. Integrate with Turkish bank verification API (if available) or use manual verification
8. Create POST `/api/bank-accounts/add` endpoint to add bank account
9. Create GET `/api/bank-accounts` endpoint to list user's bank accounts
10. Create POST `/api/bank-accounts/:id/verify` endpoint to request verification
11. For manual verification: send small random amount (like 0.23 TRY) to account
12. User must confirm the exact amount to verify ownership
13. Create POST `/api/bank-accounts/:id/confirm-amount` endpoint for user to enter amount
14. If amount matches, mark account as verified
15. Add `verified_bank_account` requirement for large orders (over 1000 TRY)
16. Create frontend component `BankAccountManager.js` to manage accounts
17. In BankAccountManager.js, show list of accounts with verification status
18. Add form to add new bank account
19. Show verification instructions when user adds account
20. Test verification flow end-to-end

---

## 🛡️ KEY TASK 16: Fraud Detection System

**Goal:** Detect and prevent fraudulent activities and suspicious patterns.

### Subtasks:

1. Create `fraud_alerts` table with columns: id, user_id, order_id, alert_type, severity, detected_at, resolved
2. Create file `services/fraudDetectionService.js` for fraud detection logic
3. Create function to detect multiple failed login attempts (more than 5 in 10 minutes)
4. Create function to detect rapid order creation (more than 10 orders in 1 hour)
5. Create function to detect orders with unusually high amounts
6. Create function to detect users with many disputes
7. Create function to detect users with low completion rate (cancel many orders)
8. Create function to detect IP address anomalies (user from different country suddenly)
9. Create function to detect device fingerprint changes
10. Install express-rate-limit and express-slow-down for protection
11. Create scheduled job to run fraud detection every 5 minutes
12. When fraud detected, create alert in fraud_alerts table
13. Send notification to admin dashboard when high-severity alert created
14. Create POST `/api/admin/fraud-alerts` endpoint to get all alerts
15. Create POST `/api/admin/fraud-alerts/:id/resolve` endpoint to mark alert as resolved
16. Automatically lock user account if critical fraud detected
17. Require manual admin review before unlocking account
18. Create frontend component `FraudAlertsDashboard.js` for admins
19. Show list of alerts with severity indicators (red, yellow, green)
20. Test fraud detection by simulating suspicious activities

---

## 📧 KEY TASK 17: Email Template System

**Goal:** Create professional, customizable email templates for all notifications.

### Subtasks:

1. Install handlebars for templating: `npm install handlebars`
2. Create folder `templates/emails/` for email templates
3. Create base email layout `templates/emails/layouts/main.hbs` with header and footer
4. Create template `welcome.hbs` for new user registration
5. Create template `order_matched.hbs` for when orders are matched
6. Create template `payment_received.hbs` for payment confirmation
7. Create template `trade_completed.hbs` for successful trade
8. Create template `dispute_raised.hbs` for dispute notifications
9. Create template `kyc_approved.hbs` for KYC approval
10. Create template `kyc_rejected.hbs` for KYC rejection
11. Create template `password_reset.hbs` for password reset
12. Create template `two_factor_enabled.hbs` for 2FA setup
13. Add company branding (logo, colors) to all templates
14. Make templates responsive for mobile devices
15. Add unsubscribe link to all marketing emails
16. Create function `renderTemplate(templateName, data)` to compile templates
17. Update notificationService.js to use templates instead of plain text
18. Create endpoint POST `/api/admin/test-email` to preview email templates
19. Add email tracking (open rates, click rates) using tracking pixels
20. Test all email templates by sending to test email address

---

## 🎯 KEY TASK 18: User Rating and Reputation System

**Goal:** Allow users to rate each other after trades to build trust.

### Subtasks:

1. Create `user_ratings` table with columns: id, rater_id, rated_user_id, order_id, rating, comment, created_at
2. Add `rating_average` column to users table (default 0.0)
3. Add `rating_count` column to users table (default 0)
4. Add `completed_trades` column to users table (default 0)
5. Create file `database/dal/ratings.js` for rating operations
6. Add function to create a new rating (1-5 stars)
7. Add function to get all ratings for a user
8. Add function to calculate average rating
9. Create POST `/api/ratings/submit` endpoint to submit rating after trade
10. Only allow rating if order is completed
11. Only allow rating once per order
12. Update user's average rating after new rating is submitted
13. Create GET `/api/users/:address/ratings` endpoint to get user's ratings
14. Create GET `/api/users/:address/stats` endpoint to get trade stats
15. Include rating badges in order listings (Gold: 4.5+, Silver: 4.0+, Bronze: 3.0+)
16. Sort orders by user rating (higher rated users shown first)
17. Create frontend component `UserRatingForm.js` for submitting ratings
18. Show star selector (1-5 stars) and optional comment field
19. Create frontend component `UserReputationBadge.js` to display ratings
20. Show user's average rating, total trades, and badges in profile
21. Test rating system by completing trades and rating users

---

## 💰 KEY TASK 19: Fee Management System

**Goal:** Track and manage transaction fees for revenue generation.

### Subtasks:

1. Create `fee_transactions` table with columns: id, order_id, user_id, fee_type, amount_try, amount_xrp, created_at
2. Create `fee_settings` table with columns: id, fee_type, percentage, flat_amount, active, updated_at
3. Insert default fee settings: maker_fee: 0.5%, taker_fee: 0.5%, withdrawal_fee: 1 TRY
4. Create file `services/feeService.js` for fee calculations
5. Create function `calculateTradingFee(orderAmount, feeType)` to calculate fee
6. Create function `calculateWithdrawalFee(amount)` for withdrawal fees
7. Create function to record fee transaction in database
8. Update order completion to calculate and record fees
9. Create GET `/api/admin/fees/settings` endpoint to get fee settings
10. Create POST `/api/admin/fees/settings` endpoint to update fee settings
11. Create GET `/api/admin/fees/revenue` endpoint to get total revenue
12. Create GET `/api/admin/fees/revenue/daily` endpoint to get daily revenue breakdown
13. Add fee information to order confirmation screen
14. Show "Estimated fee: X TRY" before user creates order
15. Deduct fees from user's balance when order completes
16. Create `user_balances` table to track user balances on platform
17. Add deposit and withdrawal functionality for TRY balances
18. Create frontend component `FeeSettings.js` for admins to adjust fees
19. Create frontend component `RevenueReport.js` showing fee revenue charts
20. Test fee calculations with different order amounts

---

## 🔄 KEY TASK 20: Automated Testing Suite

**Goal:** Create comprehensive automated tests to ensure code quality and prevent bugs.

### Subtasks:

1. Verify Jest is installed: `npm install --save-dev jest`
2. Install testing library for React: `npm install --save-dev @testing-library/react`
3. Install supertest for API testing: `npm install --save-dev supertest`
4. Create test for user registration endpoint: POST `/api/auth/register`
5. Create test for user login endpoint: POST `/api/auth/login`
6. Create test for JWT token validation
7. Create test for creating P2P order
8. Create test for matching orders
9. Create test for confirming payment
10. Create test for completing order
11. Create test for raising dispute
12. Create test for Papara account validation
13. Create test for database connection
14. Create test for all DAL functions (create, read, update, delete)
15. Create test for WebSocket connections and events
16. Create test for fraud detection service
17. Create test for fee calculations
18. Create test for user rating calculations
19. Set up GitHub Actions for automated testing on every commit
20. Create `.github/workflows/test.yml` file for CI/CD pipeline
21. Run all tests before deployment: `npm run test:ci`
22. Aim for 80% code coverage minimum

---

## 🎬 Conclusion

This PRD outlines 20 major tasks with 20 subtasks each (400 subtasks total) to make CryptoPay production-ready. Each subtask is written in simple, clear language that can be understood and implemented by any developer or AI assistant.

---

## ❓ Questions for Clarification

Before proceeding with implementation, please clarify:

1. **Priority**: Which tasks should be implemented first? (1-5 most critical)
2. **Timeline**: What is the target completion date for MVP?
3. **Team Size**: How many developers will work on this?
4. **Budget**: Are there budget constraints for third-party services (Papara, Twilio, AWS)?
5. **Compliance**: Which countries will the app operate in? (affects KYC requirements)
6. **Scale**: Expected number of users in first year?
7. **Payment Methods**: Should we support payment methods other than Papara?
8. **Mobile Priority**: Is mobile app critical for MVP or can it wait?
9. **Admin Tools**: How many admins/moderators will use the system?
10. **Testing**: Is automated testing mandatory before launch?
11. **Infrastructure**: Will you use AWS, Google Cloud, or other hosting?
12. **Backup Plan**: What's the disaster recovery plan for database?
13. **Monitoring**: Which monitoring tools should we use (Datadog, New Relic)?
14. **API Rate Limits**: What rate limits should we set for API endpoints?
15. **Escrow Insurance**: Should we have insurance for escrow failures?

---

**Status:** 🟡 Awaiting clarification before proceeding with implementation

**Next Steps:** 
1. Review this PRD
2. Answer clarification questions
3. Prioritize tasks
4. Begin implementation of highest priority tasks


