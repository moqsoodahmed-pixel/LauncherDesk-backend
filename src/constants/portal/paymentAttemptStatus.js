/**
 * Status of a single PAYMENT ATTEMPT (one Payment document) - distinct from
 * Order.paymentStatus (constants/orderPaymentStatus.js), which tracks the
 * order's overall payment state across however many attempts it took.
 * An order can accumulate several CREATED/FAILED attempts before one
 * reaches CONFIRMED.
 */
const PAYMENT_ATTEMPT_STATUS = Object.freeze({
  CREATED: 'CREATED', // Razorpay order created, checkout not yet completed
  CONFIRMED: 'CONFIRMED', // signature verified, payment captured
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
});

const ALL_PAYMENT_ATTEMPT_STATUSES = Object.values(PAYMENT_ATTEMPT_STATUS);

module.exports = { PAYMENT_ATTEMPT_STATUS, ALL_PAYMENT_ATTEMPT_STATUSES };
