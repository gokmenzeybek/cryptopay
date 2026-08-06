/**
 * Data Access Layer (DAL) Index
 * Exports all database access modules
 */

const WalletsDAL = require('./wallets');
const TransactionsDAL = require('./transactions');
const PaymentRequestsDAL = require('./paymentRequests');
const P2POrdersDAL = require('./p2pOrders');
const PaparaPaymentsDAL = require('./paparaPayments');
const SystemSettingsDAL = require('./systemSettings');
const ChatMessagesDAL = require('./chatMessages');
const WebhookEventsDAL = require('./webhookEvents');

module.exports = {
  WalletsDAL,
  TransactionsDAL,
  PaymentRequestsDAL,
  P2POrdersDAL,
  PaparaPaymentsDAL,
  SystemSettingsDAL,
  ChatMessagesDAL,
  WebhookEventsDAL
};