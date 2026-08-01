# P2P TRY-XRP Exchange API Guide

## Overview

The CryptoPay P2P TRY-XRP Exchange API enables peer-to-peer conversion between Turkish Lira (TRY) and XRP cryptocurrency using the XRP Ledger (XRPL). This system eliminates the need for third-party payment providers by directly matching buyers and sellers.

## Key Features

- **No Third-Party Providers**: Direct peer-to-peer matching without Stripe, PayPal, or MoonPay
- **Turkish Payment Methods**: Supports Bank Transfer, Papara, İninal, Mefete, and QR Havale
- **Web Scraping**: Real-time XRP/TRY rates from Turkish exchanges (BTCTurk, Paribu) and international sources
- **Smart Matching**: Reputation-based order matching algorithm
- **Dispute Resolution**: Built-in dispute handling system
- **No API Keys Required**: All exchange rates fetched from public APIs

## Architecture

### Components

1. **TRY Rate Scraper Service** (`services/tryRateScraperService.js`)
   - Scrapes XRP/TRY rates from BTCTurk, Paribu, Binance, CoinGecko
   - Calculates P2P market rate from completed orders
   - Weighted averaging (Turkish exchanges weighted higher)
   - 5-minute rate caching

2. **P2P Matching Service** (`services/p2pMatchingService.js`)
   - Creates and manages buy/sell orders
   - Smart matching algorithm (rate, amount, payment method, reputation)
   - Order lifecycle management
   - Payment and XRP confirmation tracking
   - Dispute handling

3. **Rate Limiting Middleware** (`middleware/rateLimit.js`)
   - Protects API endpoints from abuse
   - Different limits for different endpoint types

## Order Lifecycle

```
1. OPEN          → Order created, looking for matches
2. MATCHED       → Found counterparty, awaiting payment
3. PAYMENT_CONFIRMED → TRY payment confirmed, awaiting XRP
4. COMPLETED     → Both TRY and XRP transferred successfully
```

Alternative paths:
- `CANCELLED` → Order cancelled before matching
- `EXPIRED` → Order expired without match (default: 30 minutes)
- `DISPUTED` → Dispute raised during transaction

## API Endpoints

### Exchange Rates

#### GET /api/p2p/rate

Get current XRP/TRY exchange rate from multiple sources.

**Query Parameters:**
- `refresh` (optional): Set to `true` to force refresh cached rates

**Response:**
```json
{
  "success": true,
  "currency": "TRY",
  "rate": 18.45,
  "sources": [
    {
      "source": "BTCTurk",
      "rate": 18.50,
      "change24h": 2.5,
      "timestamp": "2025-10-14T10:30:00.000Z"
    },
    {
      "source": "Paribu",
      "rate": 18.48,
      "change24h": 2.3,
      "timestamp": "2025-10-14T10:30:00.000Z"
    },
    {
      "source": "Binance",
      "rate": 18.42,
      "change24h": 2.5,
      "timestamp": "2025-10-14T10:30:00.000Z"
    },
    {
      "source": "CoinGecko",
      "rate": 18.40,
      "change24h": 2.4,
      "timestamp": "2025-10-14T10:30:00.000Z"
    }
  ],
  "averageChange24h": 2.43,
  "cached": false,
  "lastUpdated": "2025-10-14T10:30:00.000Z",
  "ttl": 300,
  "marketStats": {
    "currentRate": 18.45,
    "change24h": 2.43,
    "sourcesCount": 4,
    "highestRate": 18.50,
    "lowestRate": 18.40,
    "rateSpread": 0.10
  }
}
```

#### GET /api/p2p/payment-methods

Get list of supported Turkish payment methods.

**Response:**
```json
{
  "success": true,
  "paymentMethods": [
    "bank_transfer",
    "papara",
    "ininal",
    "mefete",
    "qr_havale"
  ],
  "descriptions": {
    "bank_transfer": "Traditional bank transfer (EFT/Havale)",
    "papara": "Papara instant transfer",
    "ininal": "İninal card transfer",
    "mefete": "Mefete instant transfer",
    "qr_havale": "QR code bank transfer"
  }
}
```

### Order Management

#### POST /api/p2p/create-order

Create a new buy or sell order.

**Request Body:**
```json
{
  "type": "buy",
  "tryAmount": 1000,
  "xrpAmount": 54.2,
  "rate": 18.45,
  "xrplAddress": "rYourXRPLAddress123456789",
  "paymentMethods": ["papara", "bank_transfer"],
  "minAmount": 500,
  "maxAmount": 5000,
  "timeLimit": 30,
  "metadata": {
    "name": "Ahmet",
    "completedTrades": 15,
    "rating": 4.8
  }
}
```

**Field Descriptions:**
- `type`: Order type - `"buy"` (want to buy XRP with TRY) or `"sell"` (want to sell XRP for TRY)
- `tryAmount`: Amount in Turkish Lira
- `xrpAmount`: Amount in XRP
- `rate`: XRP/TRY exchange rate (TRY per 1 XRP)
- `xrplAddress`: Your XRPL wallet address
- `paymentMethods`: Array of accepted payment methods
- `minAmount`: Minimum order amount (optional)
- `maxAmount`: Maximum order amount (optional)
- `timeLimit`: Time limit in minutes before order expires (default: 30)
- `metadata`: User info including reputation (optional)

**Response:**
```json
{
  "success": true,
  "message": "P2P order created successfully",
  "order": {
    "id": "buy_1a2b3c4d_abc123",
    "type": "buy",
    "status": "open",
    "tryAmount": 1000,
    "xrpAmount": 54.2,
    "rate": 18.45,
    "paymentMethods": ["papara", "bank_transfer"],
    "createdAt": "2025-10-14T10:30:00.000Z",
    "expiresAt": "2025-10-14T11:00:00.000Z",
    "isExpired": false,
    "rating": 4.8,
    "completedTrades": 15
  },
  "potentialMatches": [
    {
      "id": "sell_5e6f7g8h_def456",
      "type": "sell",
      "status": "open",
      "tryAmount": 1200,
      "xrpAmount": 65,
      "rate": 18.46,
      "paymentMethods": ["papara"],
      "rating": 4.9,
      "completedTrades": 23
    }
  ]
}
```

#### GET /api/p2p/orders

Get list of all open P2P orders.

**Query Parameters:**
- `type` (optional): Filter by order type (`buy` or `sell`)
- `status` (optional): Filter by status (default: `open`)
- `limit` (optional): Maximum number of orders to return (default: 50)

**Response:**
```json
{
  "success": true,
  "count": 15,
  "orders": [
    {
      "id": "sell_5e6f7g8h_def456",
      "type": "sell",
      "status": "open",
      "tryAmount": 1200,
      "xrpAmount": 65,
      "rate": 18.46,
      "paymentMethods": ["papara", "bank_transfer"],
      "createdAt": "2025-10-14T10:25:00.000Z",
      "expiresAt": "2025-10-14T10:55:00.000Z",
      "isExpired": false,
      "rating": 4.9,
      "completedTrades": 23
    }
  ]
}
```

#### GET /api/p2p/my-orders/:address

Get user's orders by XRPL address.

**Path Parameters:**
- `address`: Your XRPL wallet address

**Query Parameters:**
- `status` (optional): Filter by status
- `limit` (optional): Maximum number of orders to return (default: 50)

**Response:**
```json
{
  "success": true,
  "address": "rYourXRPLAddress123456789",
  "count": 5,
  "orders": [
    {
      "id": "buy_1a2b3c4d_abc123",
      "type": "buy",
      "status": "completed",
      "tryAmount": 1000,
      "xrpAmount": 54.2,
      "rate": 18.45,
      "counterpartyAddress": "rCounterpartyAddress987654321",
      "matchedOrderId": "sell_5e6f7g8h_def456"
    }
  ]
}
```

### Order Matching & Execution

#### POST /api/p2p/match

Match your order with an existing counterparty order.

**Request Body:**
```json
{
  "orderId": "buy_1a2b3c4d_abc123",
  "counterpartyOrderId": "sell_5e6f7g8h_def456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Orders matched successfully",
  "match": {
    "order1": {
      "id": "buy_1a2b3c4d_abc123",
      "status": "matched",
      "counterpartyAddress": "rCounterpartyAddress987654321",
      "matchedOrderId": "sell_5e6f7g8h_def456"
    },
    "order2": {
      "id": "sell_5e6f7g8h_def456",
      "status": "matched",
      "counterpartyAddress": "rYourXRPLAddress123456789",
      "matchedOrderId": "buy_1a2b3c4d_abc123"
    },
    "details": {
      "tryAmount": 1000,
      "xrpAmount": 54.2,
      "rate": 18.45,
      "paymentMethod": "papara"
    }
  },
  "nextStep": "Buyer should now transfer TRY via the agreed payment method, then call /api/p2p/confirm-payment"
}
```

#### POST /api/p2p/confirm-payment

Confirm that TRY payment has been sent/received.

**Request Body:**
```json
{
  "orderId": "buy_1a2b3c4d_abc123",
  "proofOfPayment": {
    "transactionId": "PAP123456789",
    "screenshot": "https://...",
    "notes": "Sent via Papara"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "TRY payment confirmed",
  "order": {
    "id": "buy_1a2b3c4d_abc123",
    "status": "payment_confirmed",
    "paymentConfirmedAt": "2025-10-14T10:35:00.000Z"
  },
  "nextStep": "Seller should now transfer XRP and call /api/p2p/confirm-xrp with the transaction hash"
}
```

#### POST /api/p2p/confirm-xrp

Confirm XRP transfer on the XRPL.

**Request Body:**
```json
{
  "orderId": "sell_5e6f7g8h_def456",
  "xrpTransactionHash": "9A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C0D1E2F"
}
```

**Response:**
```json
{
  "success": true,
  "message": "P2P trade completed successfully",
  "order": {
    "id": "sell_5e6f7g8h_def456",
    "status": "completed",
    "xrpTransactionHash": "9A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C0D1E2F",
    "xrpConfirmedAt": "2025-10-14T10:37:00.000Z",
    "completedAt": "2025-10-14T10:37:00.000Z"
  },
  "xrpTransactionHash": "9A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C0D1E2F"
}
```

### Order Management

#### POST /api/p2p/cancel

Cancel an open order.

**Request Body:**
```json
{
  "orderId": "buy_1a2b3c4d_abc123",
  "reason": "Changed my mind"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Order cancelled successfully",
  "order": {
    "id": "buy_1a2b3c4d_abc123",
    "status": "cancelled",
    "cancelledAt": "2025-10-14T10:32:00.000Z",
    "cancelReason": "Changed my mind"
  }
}
```

#### POST /api/p2p/dispute

Raise a dispute for an order.

**Request Body:**
```json
{
  "orderId": "buy_1a2b3c4d_abc123",
  "reason": "Payment not received",
  "evidence": {
    "screenshots": ["https://..."],
    "description": "Sent payment but seller claims not received"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Dispute raised successfully",
  "order": {
    "id": "buy_1a2b3c4d_abc123",
    "status": "disputed",
    "disputeReason": "Payment not received",
    "disputeRaisedAt": "2025-10-14T10:40:00.000Z"
  },
  "note": "A moderator will review your dispute"
}
```

### Statistics

#### GET /api/p2p/stats

Get P2P marketplace statistics.

**Response:**
```json
{
  "success": true,
  "stats": {
    "total": 150,
    "open": 25,
    "matched": 5,
    "completed": 110,
    "cancelled": 8,
    "disputed": 2,
    "avgCompletionTime": 12,
    "totalVolumeTRY": 125000,
    "totalVolumeXRP": 6800,
    "avgRate": 18.38,
    "buyOrders": 78,
    "sellOrders": 72
  }
}
```

## Complete Trading Flow

### Scenario: User wants to buy XRP with TRY

#### Step 1: Check Current Rate
```bash
curl http://localhost:5001/api/p2p/rate
```

#### Step 2: Create Buy Order
```bash
curl -X POST http://localhost:5001/api/p2p/create-order \
  -H "Content-Type: application/json" \
  -d '{
    "type": "buy",
    "tryAmount": 1000,
    "xrpAmount": 54.2,
    "rate": 18.45,
    "xrplAddress": "rYourXRPLAddress123456789",
    "paymentMethods": ["papara", "bank_transfer"],
    "metadata": {
      "name": "Ahmet",
      "completedTrades": 15,
      "rating": 4.8
    }
  }'
```

#### Step 3: Browse Available Sell Orders
```bash
curl http://localhost:5001/api/p2p/orders?type=sell
```

#### Step 4: Match with a Seller
```bash
curl -X POST http://localhost:5001/api/p2p/match \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "buy_1a2b3c4d_abc123",
    "counterpartyOrderId": "sell_5e6f7g8h_def456"
  }'
```

#### Step 5: Send TRY Payment
- Transfer TRY via Papara/Bank to seller's account
- Get payment confirmation

#### Step 6: Confirm Payment
```bash
curl -X POST http://localhost:5001/api/p2p/confirm-payment \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "buy_1a2b3c4d_abc123",
    "proofOfPayment": {
      "transactionId": "PAP123456789",
      "screenshot": "https://...",
      "notes": "Sent via Papara"
    }
  }'
```

#### Step 7: Wait for XRP Transfer
- Seller transfers XRP to your XRPL address
- Seller confirms with transaction hash

#### Step 8: Trade Complete
```bash
curl http://localhost:5001/api/p2p/my-orders/rYourXRPLAddress123456789
```

## Rate Scraping Sources

The system automatically scrapes XRP/TRY rates from multiple sources:

| Source | Type | Weight | Description |
|--------|------|--------|-------------|
| BTCTurk | Turkish Exchange | 1.5 | Direct XRP/TRY pair |
| Paribu | Turkish Exchange | 1.5 | XRP_TL pair |
| Binance | International | 1.2 | XRP/USDT × USDT/TRY |
| CoinGecko | Aggregator | 1.0 | Free API, no key required |
| P2P Market | Internal | 1.3 | Current open orders |
| P2P Completed | Internal | 1.8 | Recent completed trades |

**Weighted Average**: Turkish exchanges and completed P2P trades are weighted higher for more accurate local market rates.

**Cache**: Rates are cached for 5 minutes to reduce API calls.

## Turkish Payment Methods

### Bank Transfer (EFT/Havale)
- Traditional bank wire transfer
- Processing time: 1-2 hours during business hours
- Most widely accepted

### Papara
- Instant mobile payment
- Processing time: 1-5 minutes
- Very popular in Turkey

### İninal
- Prepaid card system
- Processing time: 1-10 minutes
- No bank account required

### Mefete
- Digital wallet
- Processing time: Instant
- Growing adoption

### QR Havale
- QR code-based bank transfer
- Processing time: 1-5 minutes
- Supported by most Turkish banks

## Security & Best Practices

### For Buyers (Buying XRP with TRY)
1. Check seller's reputation and completed trades
2. Use escrow if available
3. Keep payment proof (screenshots, transaction IDs)
4. Verify XRPL transaction before confirming
5. Start with small amounts for new counterparties

### For Sellers (Selling XRP for TRY)
1. Check buyer's reputation
2. Confirm TRY payment before transferring XRP
3. Use preferred payment method with buyer protection
4. Verify payment notification from bank/service
5. Only transfer XRP after payment confirmation

### Dispute Resolution
1. Raise dispute immediately if issues occur
2. Provide clear evidence (screenshots, transaction IDs)
3. Be responsive to moderator requests
4. Keep all communication records

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message"
}
```

**Common HTTP Status Codes:**
- `200`: Success
- `400`: Bad request (validation error)
- `404`: Resource not found
- `429`: Rate limit exceeded
- `500`: Server error

## Rate Limiting

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Exchange Rates | 60 requests | 1 minute |
| Order Creation | 10 requests | 1 minute |
| Order Actions | 20 requests | 1 minute |

Rate limit headers in responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: When limit resets
- `Retry-After`: Seconds to wait if rate limited

## Configuration

Create `.env` file from `.env.example`:

```bash
# Rate cache TTL in seconds (default: 300 = 5 minutes)
RATE_CACHE_TTL_SECONDS=300

# Conversion fee percentage (default: 1.5%)
CONVERSION_FEE_PERCENT=1.5

# Rate limiting (requests per minute)
RATE_LIMIT_EXCHANGE_RATES=60
RATE_LIMIT_PAYMENT_INTENT=10
RATE_LIMIT_CONVERSION=20
```

## Testing

Test the API:

```bash
# Start server
npm start

# Test rate endpoint
curl http://localhost:5001/api/p2p/rate

# Test payment methods
curl http://localhost:5001/api/p2p/payment-methods

# Test order creation
curl -X POST http://localhost:5001/api/p2p/create-order \
  -H "Content-Type: application/json" \
  -d '{"type":"buy","tryAmount":1000,"xrpAmount":54.2,"rate":18.45,"xrplAddress":"rTest123","paymentMethods":["papara"]}'

# Check orders
curl http://localhost:5001/api/p2p/orders
```

## Production Considerations

- [ ] Set up proper database (replace in-memory storage)
- [ ] Implement user authentication
- [ ] Add escrow mechanism for secure trades
- [ ] Implement dispute resolution workflow
- [ ] Set up monitoring and logging
- [ ] Configure HTTPS/SSL
- [ ] Add user reputation system
- [ ] Implement chat/messaging between matched users
- [ ] Set up automated expired order cleanup
- [ ] Add email/SMS notifications
- [ ] Implement KYC for larger amounts
- [ ] Set up alerting for failed/disputed trades
- [ ] Add rate history tracking
- [ ] Implement order matching optimization

## Support & Documentation

- **Main Documentation**: See CLAUDE.md
- **API Root**: http://localhost:5001/api
- **Health Check**: http://localhost:5001/api/health

## Troubleshooting

**Rate scraping fails:**
- Check internet connection
- Turkish exchanges may be temporarily unavailable
- System will use cached rates or other sources

**Orders not matching:**
- Check rate compatibility (buyer rate ≥ seller rate)
- Verify payment method overlap
- Ensure amounts are within min/max limits

**Payment confirmation issues:**
- Verify order status is MATCHED
- Provide valid proof of payment
- Contact counterparty if payment not acknowledged

**XRP transfer issues:**
- Verify XRPL transaction hash format
- Check order status is PAYMENT_CONFIRMED
- Ensure XRP sent to correct address
