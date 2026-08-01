#!/usr/bin/env node
/**
 * Papara Service
 * Handles Papara instant transfer API integration for P2P TRY-XRP exchange
 * Supports both sandbox and production environments.
 *
 * This service NEVER fabricates data: without a configured PAPARA_API_KEY
 * every API method throws a configuration error. In production a missing key
 * is a construction-time configuration error (fail fast). Test doubles for
 * development/testing live in services/__tests__/ only.
 */

const crypto = require('node:crypto');
const { PaparaClient } = require('@papara/papara');
require('dotenv').config();
const logger = require('../utils/logger');

/**
 * Custom error classes for Papara operations
 */
class PaparaAPIError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = 'PaparaAPIError';
    this.code = code;
  }
}

class PaparaValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaparaValidationError';
  }
}

class PaparaInsufficientFundsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaparaInsufficientFundsError';
  }
}

/**
 * Mask an account number for logging: never log full account numbers (PII).
 * @param {string} accountNumber
 * @returns {string} all but the last 4 digits masked
 */
function maskAccountNumber(accountNumber) {
  const value = String(accountNumber || '');
  return `******${value.slice(-4)}`;
}

const PLACEHOLDER_API_KEY = 'your_papara_api_key_here';

/**
 * Papara Service Class
 * Provides methods for account validation, instant transfers, and payment status checking
 */
class PaparaService {
  constructor() {
    this.apiKey = process.env.PAPARA_API_KEY;
    this.environment = process.env.PAPARA_ENVIRONMENT || 'sandbox';
    this.merchantId = process.env.PAPARA_MERCHANT_ID;

    const hasValidKey = !!this.apiKey && this.apiKey !== PLACEHOLDER_API_KEY;

    // Fail fast in production: a missing/placeholder key is a configuration
    // error, never a silent fallback to fabricated data.
    if (!hasValidKey && process.env.NODE_ENV === 'production') {
      throw new PaparaAPIError(
        'PAPARA_API_KEY is not configured — refusing to start Papara service in production'
      );
    }

    if (hasValidKey) {
      this.client = new PaparaClient(this.apiKey, this.environment.toUpperCase());
      logger.info('Papara client initialized', {
        environment: this.environment,
        merchantId: this.merchantId || null
      });
    } else {
      this.client = null;
      logger.warn('PAPARA_API_KEY not configured — Papara API methods will fail with a configuration error', {
        environment: this.environment
      });
    }

    this._isSandboxMode = this.environment.toLowerCase() === 'sandbox';
  }

  /**
   * Check if running against the Papara sandbox environment
   * @returns {boolean} True if the environment is sandbox
   */
  isSandboxMode() {
    return this._isSandboxMode;
  }

  /**
   * Ensure a Papara client is configured; throw a configuration error otherwise.
   * @private
   */
  _requireClient() {
    if (!this.client) {
      throw new PaparaAPIError(
        'Papara API key is not configured — cannot make Papara API calls'
      );
    }
    return this.client;
  }

  /**
   * Validate a Papara account number
   * @param {string} accountNumber - 10-11 digit Papara account number
   * @returns {Promise<Object>} Validation result with account holder info
   * @throws {PaparaValidationError} If account format is invalid
   * @throws {PaparaAPIError} If the service is not configured or the API call fails
   */
  async validateAccount(accountNumber) {
    try {
      // Input validation
      if (!accountNumber || typeof accountNumber !== 'string') {
        throw new PaparaValidationError('Account number is required');
      }

      const cleanAccountNumber = accountNumber.trim();

      // Basic format validation
      if (!/^\d{10,11}$/.test(cleanAccountNumber)) {
        throw new PaparaValidationError('Account number must be 10-11 digits');
      }

      const client = this._requireClient();

      logger.info('Papara account validation requested', {
        accountNumber: maskAccountNumber(cleanAccountNumber)
      });

      // Make API call to Papara
      const result = await client.validationService.validateByAccountNumber({
        accountNumber: parseInt(cleanAccountNumber)
      });

      // Check if API call was successful
      if (!result.succeeded) {
        throw new PaparaAPIError(
          result.error?.message || 'Account validation failed',
          result.error?.code
        );
      }

      // Return standardized response
      return {
        success: true,
        accountExists: true,
        accountHolder: `${result.data.firstName} ${result.data.lastName}`,
        accountNumber: result.data.accountNumber.toString(),
        userId: result.data.userId,
        email: result.data.email,
        phoneNumber: result.data.phoneNumber
      };

    } catch (error) {
      if (error instanceof PaparaValidationError || error instanceof PaparaAPIError) {
        throw error;
      }

      logger.error('Papara account validation failed', {
        accountNumber: maskAccountNumber(accountNumber),
        error: error.message
      });

      // Handle network or other errors
      throw new PaparaAPIError(`Account validation failed: ${error.message}`);
    }
  }

  /**
   * Send instant transfer payment
   * @param {number} amount - Amount in TRY (Turkish Lira)
   * @param {string} recipientAccount - Recipient Papara account number
   * @param {string} description - Payment description
   * @param {Object} metadata - Additional metadata for the transaction
   *   (metadata.orderId is embedded into the referenceId so the webhook can
   *   resolve the order — see PRD 2.6.2)
   * @returns {Promise<Object>} Payment result with transaction ID
   * @throws {PaparaAPIError} If the service is not configured or payment fails
   */
  async sendPayment(amount, recipientAccount, description, metadata = {}) {
    try {
      // Input validation
      if (!amount || amount <= 0) {
        throw new PaparaValidationError('Amount must be greater than 0');
      }

      if (!recipientAccount || typeof recipientAccount !== 'string') {
        throw new PaparaValidationError('Recipient account is required');
      }

      if (!description || typeof description !== 'string') {
        throw new PaparaValidationError('Description is required');
      }

      const cleanAccountNumber = recipientAccount.trim();

      // Validate account number format
      if (!/^\d{10,11}$/.test(cleanAccountNumber)) {
        throw new PaparaValidationError('Recipient account number must be 10-11 digits');
      }

      const client = this._requireClient();

      // Create payment reference ID (carries the order ID when available so
      // the Papara webhook can resolve the order from the referenceId)
      const referenceId = metadata.orderId
        ? `P2P_${metadata.orderId}_${Date.now()}`
        : `P2P_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      const baseUrl = process.env.BASE_URL || 'http://localhost:5001';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

      const paymentPayload = {
        amount: amount,
        referenceId: referenceId,
        orderDescription: description,
        notificationUrl: `${baseUrl}/api/webhooks/papara`,
        redirectUrl: `${frontendUrl}/p2p/payment-success`,
        turkishNationalId: metadata.turkishNationalId || null
      };

      logger.info('Papara payment creation requested', {
        amount,
        recipientAccount: maskAccountNumber(cleanAccountNumber),
        referenceId
      });

      // Make API call to create payment
      const result = await client.paymentService.createPayment(paymentPayload);

      // Check if API call was successful
      if (!result.succeeded) {
        throw new PaparaAPIError(
          result.error?.message || 'Payment creation failed',
          result.error?.code
        );
      }

      // Return standardized response
      return {
        success: true,
        transactionId: result.data.id,
        referenceId: result.data.referenceId,
        status: this._mapPaymentStatus(result.data.status),
        amount: result.data.amount,
        fee: result.data.fee,
        paymentUrl: result.data.paymentUrl,
        createdAt: result.data.createdAt,
        message: 'Payment created successfully'
      };

    } catch (error) {
      if (error instanceof PaparaValidationError || error instanceof PaparaAPIError) {
        throw error;
      }

      logger.error('Papara payment creation failed', {
        amount,
        recipientAccount: maskAccountNumber(recipientAccount),
        error: error.message
      });

      // Handle network or other errors
      throw new PaparaAPIError(`Payment creation failed: ${error.message}`);
    }
  }

  /**
   * Get payment status by transaction ID
   * @param {string} transactionId - Papara transaction ID
   * @returns {Promise<Object>} Payment status information
   * @throws {PaparaAPIError} If the service is not configured or status check fails
   */
  async getPaymentStatus(transactionId) {
    try {
      if (!transactionId || typeof transactionId !== 'string') {
        throw new PaparaValidationError('Transaction ID is required');
      }

      const client = this._requireClient();

      logger.info('Papara payment status requested', { transactionId });

      // Make API call to get payment status
      const result = await client.paymentService.getPayment({
        id: transactionId
      });

      // Check if API call was successful
      if (!result.succeeded) {
        throw new PaparaAPIError(
          result.error?.message || 'Payment status check failed',
          result.error?.code
        );
      }

      // Return standardized response
      return {
        success: true,
        transactionId: result.data.id,
        status: this._mapPaymentStatus(result.data.status),
        statusDescription: result.data.statusDescription,
        amount: result.data.amount,
        fee: result.data.fee,
        createdAt: result.data.createdAt,
        paymentMethod: result.data.paymentMethod,
        paymentMethodDescription: result.data.paymentMethodDescription
      };

    } catch (error) {
      if (error instanceof PaparaValidationError || error instanceof PaparaAPIError) {
        throw error;
      }

      logger.error('Papara payment status check failed', {
        transactionId,
        error: error.message
      });

      // Handle network or other errors
      throw new PaparaAPIError(`Payment status check failed: ${error.message}`);
    }
  }

  /**
   * Get merchant account balance
   * @returns {Promise<Object>} Account balance information
   * @throws {PaparaAPIError} If the service is not configured or balance check fails
   */
  async getAccountBalance() {
    try {
      const client = this._requireClient();

      logger.info('Papara account balance requested');

      // Make API call to get account balance
      const result = await client.accountService.getAccount();

      // Check if API call was successful
      if (!result.succeeded) {
        throw new PaparaAPIError(
          result.error?.message || 'Account balance check failed',
          result.error?.code
        );
      }

      // Return standardized response
      return {
        success: true,
        balance: result.data.balance,
        currency: result.data.currency,
        accountNumber: result.data.accountNumber,
        merchantId: result.data.merchantId
      };

    } catch (error) {
      if (error instanceof PaparaAPIError) {
        throw error;
      }

      logger.error('Papara account balance check failed', { error: error.message });

      // Handle network or other errors
      throw new PaparaAPIError(`Account balance check failed: ${error.message}`);
    }
  }

  /**
   * Map Papara payment status to standardized status
   * @param {number} status - Papara status code
   * @returns {string} Standardized status
   */
  _mapPaymentStatus(status) {
    switch (status) {
      case 0:
        return 'pending';
      case 1:
        return 'completed';
      case 2:
        return 'refunded';
      default:
        return 'unknown';
    }
  }
}

module.exports = {
  PaparaService,
  PaparaAPIError,
  PaparaValidationError,
  PaparaInsufficientFundsError
};
