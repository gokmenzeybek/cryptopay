# Fiat-to-XRP Conversion API Guide

## Overview

The CryptoPay Fiat-to-XRP API enables seamless conversion of fiat currencies (USD, EUR, GBP, etc.) to XRP cryptocurrency using the XRP Ledger (XRPL). This guide covers the complete API implementation, usage examples, and integration instructions.

## Architecture

### Components

1. **Exchange Rate Service** (`services/exchangeRateService.js`)
   - Fetches real-time XRP exchange rates from CoinGecko and CryptoCompare
   - Caches rates for 5 minutes to reduce API calls
   - Calculates XRP amounts with fee deduction
   - Supports 10 major currencies

2. **Fiat Payment Service** (`services/fiatPaymentService.js`)
   - Creates payment intents for fiat purchases
   - Tracks payment status (created → pending → confirmed → completed)
   - Handles payment confirmations and refunds
   - Simulates payment provider integration (Stripe/PayPal/MoonPay)

3. **XRPL Conversion Service** (`services/xrplConversionService.js`)
   - Manages XRP transfer after fiat confirmation
   - Tracks conversion status
   - Prepares XRPL transactions
   - Provides conversion analytics

4. **Rate Limiting Middleware** (`middleware/rateLimit.js`)
   - Protects API endpoints from abuse
   - Different limits for different endpoint types
   - Automatic cleanup of old entries

## API Endpoints

### Exchange Rates

#### GET /api/fiat/rates
Get all supported currency rates for XRP.

**Query Parameters:**
- `refresh` (optional): Set to `true` to force refresh cached rates

**Response:**
```json
{
  "success": true,
  "rates": {
    "USD": {
      "rate": 0.52,
      "xrp_per_unit": 1.923,
      "change_24h": 2.5,
      "source": "coingecko"
    },
    "EUR": { ... },
    ...
  },
  "cached": true,
  "lastUpdated": "2025-10-14T10:30:00.000Z",
  "nextUpdate": "2025-10-14T10:35:00.000Z",
  "ttl": 300
}
```

#### GET /api/fiat/rates/:currency
Get rate for a specific currency (e.g., `/api/fiat/rates/USD`).

**Response:**
```json
{
  "success": true,
  "currency": "USD",
  "rate": 0.52,
  "xrp_per_unit": 1.923,
  "change_24h": 2.5,
  "source": "coingecko",
  "cached": false,
  "lastUpdated": "2025-10-14T10:30:00.000Z"
}
```

#### GET /api/fiat/currencies
Get list of supported fiat currencies.

**Response:**
```json
{
  "success": true,
  "currencies": ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "INR", "MXN"]
}
```

### Payment Intents

#### POST /api/fiat/create-payment-intent
Create a new payment intent to convert fiat to XRP.

**Request Body:**
```json
{
  "fiatAmount": 100,
  "fiatCurrency": "USD",
  "recipientAddress": "rYourXRPLAddress123456789",
  "metadata": {
    "email": "user@example.com",
    "userId": "user123"
  }
}
```

**Response:**
```json
{
  "success": true,
  "paymentIntent": {
    "id": "pi_1a2b3c4d5e_abc123def456",
    "status": "created",
    "fiatAmount": 100,
    "fiatCurrency": "USD",
    "xrpAmount": 189.6,
    "recipientAddress": "rYourXRPLAddress123456789",
    "createdAt": "2025-10-14T10:30:00.000Z",
    "expiresAt": "2025-10-14T11:00:00.000Z",
    "expiresIn": 1800,
    "isExpired": false,
    "provider": "simulation"
  },
  "calculation": {
    "fiatAmount": 100,
    "fiatCurrency": "USD",
    "xrpRate": 0.52,
    "xrpBeforeFee": 192.307692,
    "fee": 2.884615,
    "feePercent": 1.5,
    "xrpAmount": 189.423077,
    "calculation": {
      "step1": "100 USD ÷ 0.52 = 192.307692 XRP",
      "step2": "Fee (1.5%): 2.884615 XRP",
      "step3": "Final: 189.423077 XRP"
    }
  },
  "paymentMethods": ["card", "ach", "wire", "paypal", "apple_pay", "google_pay"]
}
```

#### GET /api/fiat/payment-intent/:id
Get status of a payment intent.

**Response:**
```json
{
  "success": true,
  "paymentIntent": {
    "id": "pi_1a2b3c4d5e_abc123def456",
    "status": "confirmed",
    "fiatAmount": 100,
    "fiatCurrency": "USD",
    "xrpAmount": 189.423077,
    "recipientAddress": "rYourXRPLAddress123456789",
    "createdAt": "2025-10-14T10:30:00.000Z",
    "expiresAt": "2025-10-14T11:00:00.000Z",
    "expiresIn": 1200,
    "isExpired": false,
    "confirmedAt": "2025-10-14T10:32:00.000Z",
    "paymentMethod": "card",
    "provider": "simulation"
  }
}
```

#### POST /api/fiat/confirm-payment
Simulate payment confirmation (for testing).

**Request Body:**
```json
{
  "paymentIntentId": "pi_1a2b3c4d5e_abc123def456",
  "paymentMethod": "card"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment confirmed",
  "paymentIntent": { ... },
  "estimatedProcessingTime": "1-5 minutes"
}
```

### Conversions

#### POST /api/fiat/process-conversion
Process the conversion after payment is confirmed.

**Request Body:**
```json
{
  "paymentIntentId": "pi_1a2b3c4d5e_abc123def456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Conversion completed",
  "conversion": {
    "id": "conv_1a2b3c_abc123",
    "status": "completed",
    "fiatAmount": 100,
    "fiatCurrency": "USD",
    "xrpAmount": 189.423077,
    "recipientAddress": "rYourXRPLAddress123456789",
    "xrpTransactionHash": "9A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C0D1E2F",
    "createdAt": "2025-10-14T10:32:00.000Z",
    "completedAt": "2025-10-14T10:32:05.000Z",
    "exchangeRate": 0.527855,
    "canRetry": false
  },
  "xrpTransactionHash": "9A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C0D1E2F"
}
```

#### GET /api/fiat/conversions
Get list of all conversions with statistics.

**Query Parameters:**
- `limit` (optional): Max number of conversions to return (default: 50)
- `status` (optional): Filter by status (pending, processing, completed, failed)

**Response:**
```json
{
  "success": true,
  "count": 25,
  "conversions": [
    {
      "id": "conv_1a2b3c_abc123",
      "status": "completed",
      "fiatAmount": 100,
      "fiatCurrency": "USD",
      "xrpAmount": 189.423077,
      "recipientAddress": "rYourXRPLAddress123456789",
      "xrpTransactionHash": "9A2B3C...",
      "createdAt": "2025-10-14T10:32:00.000Z",
      "completedAt": "2025-10-14T10:32:05.000Z",
      "exchangeRate": 0.527855,
      "canRetry": false
    },
    ...
  ],
  "stats": {
    "total": 25,
    "completed": 23,
    "pending": 1,
    "failed": 1,
    "totalFiatVolume": {
      "USD": 2500,
      "EUR": 1000,
      "GBP": 500
    },
    "totalXRPVolume": 7500.5,
    "averageConversionTime": 5
  }
}
```

#### GET /api/fiat/conversions/:id
Get details of a specific conversion.

#### POST /api/fiat/conversions/:id/refund
Request a refund for a completed conversion.

**Request Body:**
```json
{
  "reason": "User requested refund"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Refund processed",
  "refund": {
    "success": true,
    "refundAmount": 100,
    "currency": "USD",
    "refundId": "rf_abc123def456",
    "processedAt": "2025-10-14T10:35:00.000Z"
  },
  "conversion": { ... }
}
```

### Webhooks

#### POST /api/fiat/webhook
Receive webhooks from payment providers.

**Headers:**
- `x-webhook-signature`: Signature for verification (optional in simulation mode)

**Request Body:**
```json
{
  "event": "payment.confirmed",
  "paymentIntentId": "pi_1a2b3c4d5e_abc123def456",
  "data": {
    "amount": 100,
    "currency": "USD",
    "status": "confirmed"
  }
}
```

**Response:**
```json
{
  "success": true,
  "received": true,
  "event": "payment.confirmed"
}
```

## Complete Flow Example

### Step 1: Create Payment Intent
```bash
curl -X POST http://localhost:5001/api/fiat/create-payment-intent \
  -H "Content-Type: application/json" \
  -d '{
    "fiatAmount": 100,
    "fiatCurrency": "USD",
    "recipientAddress": "rYourXRPLAddress123456789"
  }'
```

### Step 2: Confirm Payment (Simulation)
```bash
curl -X POST http://localhost:5001/api/fiat/confirm-payment \
  -H "Content-Type: application/json" \
  -d '{
    "paymentIntentId": "pi_1a2b3c4d5e_abc123def456",
    "paymentMethod": "card"
  }'
```

### Step 3: Process Conversion
```bash
curl -X POST http://localhost:5001/api/fiat/process-conversion \
  -H "Content-Type: application/json" \
  -d '{
    "paymentIntentId": "pi_1a2b3c4d5e_abc123def456"
  }'
```

### Step 4: Check Conversion Status
```bash
curl http://localhost:5001/api/fiat/conversions
```

## Rate Limiting

The API implements rate limiting to prevent abuse:

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Exchange Rates | 60 requests | 1 minute |
| Payment Intents | 10 requests | 1 minute |
| Conversions | 20 requests | 1 minute |
| Webhooks | 100 requests | 1 minute |

Rate limit headers are included in responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: When the rate limit resets
- `Retry-After`: Seconds to wait if rate limited (429 response)

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Basic configuration
CONVERSION_FEE_PERCENT=1.5
RATE_CACHE_TTL_SECONDS=300
PAYMENT_PROVIDER=simulation

# Optional: Real payment provider keys
# STRIPE_SECRET_KEY=sk_test_...
# PAYPAL_CLIENT_ID=...
# MOONPAY_SECRET_KEY=...

# Optional: Exchange rate API keys
# CRYPTOCOMPARE_API_KEY=your_api_key
```

## Integration with Payment Providers

### Stripe Integration (Production)

1. Install Stripe SDK: `npm install stripe`
2. Configure `STRIPE_SECRET_KEY` in `.env`
3. Update `PAYMENT_PROVIDER=stripe`
4. Implement Stripe-specific logic in `fiatPaymentService.js`

### PayPal Integration (Production)

1. Install PayPal SDK: `npm install @paypal/checkout-server-sdk`
2. Configure `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env`
3. Update `PAYMENT_PROVIDER=paypal`
4. Implement PayPal-specific logic in `fiatPaymentService.js`

### MoonPay Integration (Production)

1. Sign up at https://www.moonpay.com
2. Configure `MOONPAY_SECRET_KEY` in `.env`
3. Update `PAYMENT_PROVIDER=moonpay`
4. Implement MoonPay-specific logic in `fiatPaymentService.js`

## Security Considerations

1. **API Keys**: Never commit real API keys to version control
2. **Webhook Verification**: Enable signature verification in production
3. **Rate Limiting**: Adjust limits based on your needs
4. **HTTPS**: Always use HTTPS in production
5. **Input Validation**: All inputs are validated server-side
6. **Amount Limits**: Min/max amounts enforced per currency

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message"
}
```

Common HTTP status codes:
- `200`: Success
- `400`: Bad request (validation error)
- `404`: Resource not found
- `429`: Rate limit exceeded
- `500`: Server error

## Testing

Test the API using the provided test suite:

```bash
npm test
```

Or test manually:
```bash
# Start server
npm start

# In another terminal, test the flow
curl http://localhost:5001/api/fiat/rates
curl http://localhost:5001/api/fiat/currencies
```

## Support & Documentation

- **Main Documentation**: See CLAUDE.md
- **API Documentation**: http://localhost:5001/api
- **Exchange Rate Sources**:
  - CoinGecko: https://www.coingecko.com/en/api
  - CryptoCompare: https://min-api.cryptocompare.com

## Production Checklist

- [ ] Configure real payment provider (Stripe/PayPal/MoonPay)
- [ ] Set up proper database (replace in-memory storage)
- [ ] Enable webhook signature verification
- [ ] Configure HTTPS/SSL
- [ ] Set up monitoring and logging
- [ ] Implement hot wallet security
- [ ] Set appropriate rate limits
- [ ] Configure CORS for your domain
- [ ] Set up backup exchange rate sources
- [ ] Implement transaction retry logic
- [ ] Set up alerting for failed conversions
