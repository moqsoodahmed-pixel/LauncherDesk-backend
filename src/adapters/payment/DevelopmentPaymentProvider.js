const crypto = require('crypto');
const PaymentProviderInterface = require('./PaymentProvider.interface');
const logger = require('../../utils/portal/logger');

/**
 * Local/dev-only payment provider. Simulates a successful payment flow
 * without contacting any real payment gateway, so the app is fully
 * runnable before Razorpay credentials exist. NEVER selected in production
 * (see adapters/payment/index.js).
 */
class DevelopmentPaymentProvider extends PaymentProviderInterface {
  async createOrder({ amount, currency = 'INR', receipt }) {
    const providerOrderId = `dev_order_${crypto.randomUUID()}`;
    logger.info(`[DevelopmentPaymentProvider] Simulated order created: ${providerOrderId} (${amount} ${currency}, receipt=${receipt})`);
    return { providerOrderId, raw: { amount, currency, receipt, simulated: true } };
  }

  // Deterministic fake signature so dev/test flows can exercise the real
  // verification code path end to end rather than special-casing around it:
  // `sign(providerOrderId, providerPaymentId)` must match what the
  // "checkout" (fakeCheckout helper in seed/tests) hands back.
  static sign(providerOrderId, providerPaymentId) {
    return crypto.createHash('sha256').update(`${providerOrderId}|${providerPaymentId}|dev-simulated`).digest('hex');
  }

  async verifyPayment({ providerOrderId, providerPaymentId, signature }) {
    return signature === DevelopmentPaymentProvider.sign(providerOrderId, providerPaymentId);
  }

  verifyWebhookSignature({ rawBody, signature }) {
    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    return signature === crypto.createHash('sha256').update(`dev-webhook|${body}`).digest('hex');
  }

  async fetchPayment(providerPaymentId) {
    return { id: providerPaymentId, status: 'captured', simulated: true };
  }

  async refundPayment({ providerPaymentId, amount }) {
    const refundId = `dev_refund_${crypto.randomUUID()}`;
    logger.info(`[DevelopmentPaymentProvider] Simulated refund ${refundId} for ${providerPaymentId} (${amount})`);
    return { refundId, status: 'processed', raw: { simulated: true } };
  }
}

module.exports = DevelopmentPaymentProvider;
