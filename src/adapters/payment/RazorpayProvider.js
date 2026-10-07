const Razorpay = require('razorpay');
const { validateWebhookSignature, validatePaymentVerification } = require('razorpay/dist/utils/razorpay-utils');
const PaymentProviderInterface = require('./PaymentProvider.interface');
const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');

/**
 * Real Razorpay integration. The server is the only party that ever talks
 * to this adapter - the frontend only ever receives a Razorpay order id,
 * the public key id, and an amount/currency that ECHO what the server
 * already decided (never the other way around).
 */
class RazorpayProvider extends PaymentProviderInterface {
  constructor() {
    super();
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      logger.warn('[RazorpayProvider] Credentials missing - this provider should not be selected.');
    }
    this.client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }

  /** amount is already an integer in the smallest currency unit (paise for INR). */
  async createOrder({ amount, currency = 'INR', receipt, notes }) {
    const order = await this.client.orders.create({ amount, currency, receipt, notes });
    return { providerOrderId: order.id, raw: order };
  }

  /**
   * Checkout-returned signature verification. Uses Razorpay's own documented
   * HMAC-SHA256(order_id + "|" + payment_id, key_secret) algorithm via the
   * SDK's own helper - never reimplemented by hand.
   */
  async verifyPayment({ providerOrderId, providerPaymentId, signature }) {
    try {
      return validatePaymentVerification({ order_id: providerOrderId, payment_id: providerPaymentId }, signature, env.RAZORPAY_KEY_SECRET);
    } catch (err) {
      logger.warn(`[RazorpayProvider] Signature verification threw: ${err.message}`);
      return false;
    }
  }

  /** Webhook signature is HMAC-SHA256 over the RAW request body with the separate webhook secret. */
  verifyWebhookSignature({ rawBody, signature }) {
    if (!signature) return false;
    try {
      return validateWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
    } catch (err) {
      logger.warn(`[RazorpayProvider] Webhook signature verification threw: ${err.message}`);
      return false;
    }
  }

  async fetchPayment(providerPaymentId) {
    return this.client.payments.fetch(providerPaymentId);
  }

  async refundPayment({ providerPaymentId, amount, notes }) {
    const refund = await this.client.payments.refund(providerPaymentId, { amount, notes });
    return { refundId: refund.id, status: refund.status, raw: refund };
  }
}

module.exports = RazorpayProvider;
