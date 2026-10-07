const express = require('express');
const router = express.Router();

const { getPaymentProvider } = require('../../adapters/payment');
const paymentController = require('../../controllers/portal/payment.controller');

/**
 * Razorpay webhook. Mounted directly on the app (see app.js), BEFORE the
 * global express.json()/mongoSanitize()/xss() middleware, because the
 * signature must be verified against the EXACT raw bytes Razorpay sent -
 * re-serializing a parsed-then-reparsed JSON body can produce a
 * byte-for-byte different string and silently break verification.
 * `express.raw()` here gives this route (and only this route) a Buffer
 * body; every other route keeps the normal JSON-parsed body untouched.
 *
 * No authenticate()/requirePermission() here - Razorpay does not send a
 * user JWT. The signature check below IS this route's authentication.
 */
router.post('/razorpay', express.raw({ type: '*/*', limit: '1mb' }), (req, res, next) => {
  const signature = req.headers['x-razorpay-signature'];
  const provider = getPaymentProvider();
  const isValid = provider.verifyWebhookSignature({ rawBody: req.body, signature });

  if (!isValid) {
    return res.status(400).json({ success: false, message: 'Invalid webhook signature.', code: 'VALIDATION_ERROR' });
  }

  req.rawBody = req.body;
  return paymentController.webhook(req, res, next);
});

module.exports = router;
