const env = require('../../config/portal');
const { ORDER_STATUS } = require('../../constants/portal/orderStatus');

/**
 * Decides WHEN a document becomes eligible for secure deletion. A document
 * is never deleted immediately on upload or verification - only once its
 * order has reached KYC_DELETION_PENDING (see docs/database-structure.md's
 * order lifecycle) AND the configured retention window has elapsed since
 * the order was completed. `RETENTION_DAYS` (reused from Phase 0, not a
 * new KYC-specific duplicate) is the single source of truth for the
 * window length - never hardcoded elsewhere.
 */
function isOrderEligibleForDeletion(order) {
  if (order.status !== ORDER_STATUS.KYC_DELETION_PENDING) return false;
  if (!order.completedAt) return true; // no completion timestamp recorded - don't block deletion on a data gap
  const elapsedMs = Date.now() - new Date(order.completedAt).getTime();
  const retentionMs = env.RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return elapsedMs >= retentionMs;
}

function retentionDeadline(order) {
  if (!order.completedAt) return null;
  return new Date(new Date(order.completedAt).getTime() + env.RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

module.exports = { isOrderEligibleForDeletion, retentionDeadline };
