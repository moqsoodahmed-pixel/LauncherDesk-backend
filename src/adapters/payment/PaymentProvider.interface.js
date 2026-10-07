/**
 * Interface every payment provider adapter must implement.
 * Not enforced by the language, but documents the required contract.
 *
 *   createOrder({ amount, currency, receipt }) -> { providerOrderId, raw }
 *   verifyPayment({ providerOrderId, providerPaymentId, signature }) -> boolean
 *   verifyWebhookSignature({ rawBody, signature }) -> boolean
 *   fetchPayment(providerPaymentId) -> provider payment object (for reconciliation)
 *   refundPayment({ providerPaymentId, amount }) -> { refundId, status, raw }
 */
class PaymentProviderInterface {
  async createOrder(_params) {
    throw new Error('createOrder() not implemented');
  }

  async verifyPayment(_params) {
    throw new Error('verifyPayment() not implemented');
  }

  verifyWebhookSignature(_params) {
    throw new Error('verifyWebhookSignature() not implemented');
  }

  async fetchPayment(_providerPaymentId) {
    throw new Error('fetchPayment() not implemented');
  }

  async refundPayment(_params) {
    throw new Error('refundPayment() not implemented');
  }
}

module.exports = PaymentProviderInterface;
