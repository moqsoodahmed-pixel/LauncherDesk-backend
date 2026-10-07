const env = require('../../config/portal');
const RazorpayProvider = require('./RazorpayProvider');
const DevelopmentPaymentProvider = require('./DevelopmentPaymentProvider');

/**
 * Selects the payment provider based on environment configuration.
 * Falls back to the development provider whenever Razorpay credentials
 * are absent, and refuses to silently use fake payments in production.
 */
function getPaymentProvider() {
  const hasRazorpayCreds = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

  if (hasRazorpayCreds) {
    if (env.isProduction && !env.RAZORPAY_WEBHOOK_SECRET) {
      throw new Error('RAZORPAY_WEBHOOK_SECRET is required in production whenever Razorpay is enabled. Refusing to start unsafe.');
    }
    return new RazorpayProvider();
  }

  if (env.isProduction) {
    throw new Error('Razorpay credentials are required in production. Refusing to use DevelopmentPaymentProvider.');
  }

  return new DevelopmentPaymentProvider();
}

module.exports = { getPaymentProvider };
