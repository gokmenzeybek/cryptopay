# Papara Integration API Documentation

## Overview

The Papara integration provides seamless instant transfer capabilities for the P2P TRY-XRP exchange system. This document outlines the API endpoints, request/response formats, and integration details.

## Table of Contents

1. [Authentication](#authentication)
2. [Environment Configuration](#environment-configuration)
3. [API Endpoints](#api-endpoints)
4. [Error Handling](#error-handling)
5. [Testing](#testing)
6. [Deployment Guide](#deployment-guide)

## Authentication

The Papara integration uses API key-based authentication. The API key is configured via environment variables:

```bash
PAPARA_API_KEY=your_papara_api_key_here
PAPARA_ENVIRONMENT=sandbox  # or 'production'
PAPARA_MERCHANT_ID=your_merchant_id
```

## Environment Configuration

### Sandbox Mode
- **Environment**: `sandbox`
- **API Key**: Use test API key provided by Papara
- **Features**: Mock responses for testing without real transactions

### Production Mode
- **Environment**: `production`
- **API Key**: Use live API key from Papara
- **Features**: Real transactions and live API calls

## API Endpoints

### 1. Validate Papara Account

Validates a Papara account number and returns account holder information.

**Endpoint**: `POST /api/p2p/validate-papara-account`

**Request Body**:
```json
{
  "accountNumber": "1234567890"
}
```

**Response**:
```json
{
  "success": true,
  "accountExists": true,
  "accountHolder": "John Doe",
  "accountNumber": "1234567890",
  "message": "Account validated successfully"
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Failed to validate Papara account",
  "message": "Account not found"
}
```

### 2. Initiate Papara Payment

Initiates a Papara instant transfer payment for a matched P2P order.

**Endpoint**: `POST /api/p2p/initiate-papara-payment`

**Request Body**:
```json
{
  "orderId": "order_123456",
  "paparaAccountNumber": "1234567890"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Papara payment initiated successfully",
  "transactionId": "tx_123456789",
  "referenceId": "ref_123456789",
  "status": "pending",
  "paymentUrl": "https://papara.com/pay/tx_123456789",
  "amount": 100.00,
  "fee": 1.00,
  "order": {
    "orderId": "order_123456",
    "status": "payment_confirmed",
    "amountTry": 100.00,
    "amountXrp": 10.00
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Payment initiation failed",
  "message": "Insufficient funds"
}
```

### 3. Get Papara Payment Status

Retrieves the current status of a Papara payment transaction.

**Endpoint**: `GET /api/p2p/papara-payment-status/:orderId`

**Response**:
```json
{
  "success": true,
  "transactionId": "tx_123456789",
  "status": "completed",
  "statusDescription": "Payment completed",
  "amount": 100.00,
  "fee": 1.00,
  "createdAt": "2024-01-15T10:30:00Z",
  "paymentMethod": 0,
  "paymentMethodDescription": "Papara Balance",
  "orderStatus": "completed"
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Failed to get payment status",
  "message": "Transaction not found"
}
```

### 4. Get Papara Account Balance

Retrieves the current balance of the merchant's Papara account.

**Endpoint**: `GET /api/p2p/papara-balance`

**Response**:
```json
{
  "success": true,
  "balance": 10000.00,
  "currency": "TRY",
  "accountNumber": "1234567890",
  "merchantId": "merchant_123"
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Failed to get account balance",
  "message": "Unauthorized"
}
```

## Error Handling

### Error Types

1. **Validation Errors**: Invalid input parameters
2. **API Errors**: Papara API communication failures
3. **Business Logic Errors**: Order status conflicts, insufficient funds
4. **Network Errors**: Connection timeouts, network failures

### Error Response Format

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error category",
  "message": "Detailed error description"
}
```

### Common Error Codes

| Error Code | Description | Resolution |
|------------|-------------|------------|
| `MISSING_FIELD` | Required field missing | Provide all required fields |
| `INVALID_ACCOUNT` | Invalid account number | Verify account number format |
| `ORDER_NOT_FOUND` | Order doesn't exist | Check order ID |
| `INVALID_STATUS` | Order in wrong status | Check order status |
| `INSUFFICIENT_FUNDS` | Not enough balance | Add funds to account |
| `API_RATE_LIMIT` | Too many requests | Wait and retry |
| `NETWORK_ERROR` | Connection failed | Check network connection |

## Testing

### Unit Tests

Run unit tests for the Papara service:

```bash
npm test -- services/__tests__/paparaService.test.js
```

### Integration Tests

Run integration tests for the complete P2P flow:

```bash
npm test -- services/__tests__/paparaIntegration.test.js
```

### Test Coverage

The test suite covers:
- Account validation
- Payment initiation
- Payment status checking
- Balance retrieval
- Error handling
- Complete P2P transaction flow

## Deployment Guide

### Prerequisites

1. **Papara Merchant Account**: Register with Papara and obtain API credentials
2. **Node.js**: Version 16 or higher
3. **PostgreSQL**: Database for storing P2P orders
4. **Docker**: For containerized deployment

### Environment Setup

1. **Copy environment template**:
   ```bash
   cp .env.example .env
   ```

2. **Configure environment variables**:
   ```bash
   # Papara Configuration
   PAPARA_API_KEY=your_papara_api_key_here
   PAPARA_ENVIRONMENT=sandbox  # or 'production'
   PAPARA_MERCHANT_ID=your_merchant_id
   
   # Database Configuration
   POSTGRES_PASSWORD=cryptopay_password
   ```

### Database Migration

Run the database migration to add Papara-specific fields:

```bash
npm run db:migrate
```

This will add the following columns to the `p2p_orders` table:
- `papara_account_number`
- `counterparty_papara_account`
- `papara_transaction_id`
- `papara_payment_status`
- `papara_verified_at`

### Docker Deployment

1. **Build and start services**:
   ```bash
   docker-compose up -d
   ```

2. **Verify deployment**:
   ```bash
   docker-compose ps
   ```

3. **Check logs**:
   ```bash
   docker-compose logs -f cryptopay
   ```

### Production Deployment

1. **Set production environment**:
   ```bash
   PAPARA_ENVIRONMENT=production
   PAPARA_API_KEY=your_live_api_key
   ```

2. **Update database**:
   ```bash
   npm run db:migrate
   ```

3. **Deploy with Docker**:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

### Monitoring

1. **Health Check**: Monitor API endpoints for availability
2. **Log Monitoring**: Check application logs for errors
3. **Database Monitoring**: Monitor database performance
4. **Papara API Monitoring**: Check API rate limits and errors

### Security Considerations

1. **API Key Security**: Store API keys securely, never commit to version control
2. **HTTPS**: Use HTTPS in production for all API communications
3. **Rate Limiting**: Implement rate limiting to prevent abuse
4. **Input Validation**: Validate all input parameters
5. **Error Handling**: Don't expose sensitive information in error messages

### Troubleshooting

#### Common Issues

1. **API Key Invalid**:
   - Verify API key is correct
   - Check environment variable is set
   - Ensure API key has required permissions

2. **Database Connection Failed**:
   - Check database credentials
   - Verify database is running
   - Check network connectivity

3. **Payment Initiation Failed**:
   - Check account balance
   - Verify account number format
   - Check order status

4. **Status Check Failed**:
   - Verify transaction ID exists
   - Check API rate limits
   - Ensure network connectivity

#### Debug Mode

Enable debug logging by setting:

```bash
DEBUG=papara:*
```

This will provide detailed logs for troubleshooting.

### Support

For technical support:
1. Check the logs for error details
2. Verify environment configuration
3. Test with sandbox mode first
4. Contact Papara support for API-related issues

## API Rate Limits

Papara API has rate limits that should be respected:

- **Account Validation**: 100 requests per minute
- **Payment Creation**: 50 requests per minute
- **Status Checks**: 200 requests per minute
- **Balance Checks**: 20 requests per minute

Implement appropriate retry logic with exponential backoff for rate limit errors.

## Changelog

### Version 1.0.0
- Initial Papara integration
- Account validation
- Payment initiation
- Payment status checking
- Balance retrieval
- Complete P2P flow support
- Comprehensive test coverage
