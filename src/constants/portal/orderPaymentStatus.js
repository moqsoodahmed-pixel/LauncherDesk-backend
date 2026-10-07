/**
 * Payment-state FOUNDATION only (Phase 5). No real payment capture exists
 * yet - Razorpay integration is Phase 8. `PENDING`/`PAID`/`FAILED` can be
 * moved between by an authorized internal user for testing
 * (PATCH /api/orders/:id/payment-status), always audited, never faked as
 * a side effect of any other action.
 */
const ORDER_PAYMENT_STATUS = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED', // free/zero-amount order - no payment ever expected
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
});

const ALL_ORDER_PAYMENT_STATUSES = Object.values(ORDER_PAYMENT_STATUS);

const ORDER_PAYMENT_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_PAYMENT_STATUS.NOT_REQUIRED]: [],
  [ORDER_PAYMENT_STATUS.PENDING]: [ORDER_PAYMENT_STATUS.PAID, ORDER_PAYMENT_STATUS.FAILED],
  [ORDER_PAYMENT_STATUS.PAID]: [ORDER_PAYMENT_STATUS.REFUNDED],
  [ORDER_PAYMENT_STATUS.FAILED]: [ORDER_PAYMENT_STATUS.PENDING],
  [ORDER_PAYMENT_STATUS.REFUNDED]: [],
});

function isValidPaymentStatusTransition(from, to) {
  if (from === to) return false;
  return (ORDER_PAYMENT_STATUS_TRANSITIONS[from] || []).includes(to);
}

module.exports = {
  ORDER_PAYMENT_STATUS,
  ALL_ORDER_PAYMENT_STATUSES,
  ORDER_PAYMENT_STATUS_TRANSITIONS,
  isValidPaymentStatusTransition,
};
