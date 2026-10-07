/**
 * Order lifecycle states and the allowed transition graph.
 *
 * This is the single source of truth for order state transitions.
 * The actual enforcement happens in services/orderStateMachine.service.js,
 * which every status-changing controller must go through. Nothing in the
 * app should set order.status directly without going through that service.
 */
const ORDER_STATUS = Object.freeze({
  CREATED: 'CREATED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  ASSIGNED: 'ASSIGNED',
  KYC_PENDING: 'KYC_PENDING',
  KYC_SUBMITTED: 'KYC_SUBMITTED',
  KYC_VERIFICATION: 'KYC_VERIFICATION',
  KYC_REJECTED: 'KYC_REJECTED',
  IN_PROGRESS: 'IN_PROGRESS',
  QUALITY_CHECK: 'QUALITY_CHECK',
  COMPLETED: 'COMPLETED',
  DELIVERED: 'DELIVERED',
  KYC_DELETION_PENDING: 'KYC_DELETION_PENDING',
  CLOSED: 'CLOSED',
  ARCHIVED: 'ARCHIVED',
  CANCELLED: 'CANCELLED',
});

const ALL_ORDER_STATUSES = Object.values(ORDER_STATUS);

/**
 * Allowed forward transitions. Key = current status, value = array of
 * statuses it may move to next. CANCELLED is reachable from most
 * "in-flight" states (handled separately as a universal exception in the
 * state machine service) rather than duplicated in every row here.
 */
const ORDER_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.CREATED]: [ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAYMENT_PENDING]: [ORDER_STATUS.PAYMENT_CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAYMENT_CONFIRMED]: [ORDER_STATUS.ASSIGNED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.ASSIGNED]: [ORDER_STATUS.KYC_PENDING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.KYC_PENDING]: [ORDER_STATUS.KYC_SUBMITTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.KYC_SUBMITTED]: [ORDER_STATUS.KYC_VERIFICATION, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.KYC_VERIFICATION]: [
    ORDER_STATUS.IN_PROGRESS,
    ORDER_STATUS.KYC_PENDING,
    ORDER_STATUS.KYC_REJECTED,
    ORDER_STATUS.CANCELLED,
  ],
  [ORDER_STATUS.KYC_REJECTED]: [ORDER_STATUS.KYC_PENDING, ORDER_STATUS.KYC_SUBMITTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.IN_PROGRESS]: [ORDER_STATUS.QUALITY_CHECK, ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.QUALITY_CHECK]: [ORDER_STATUS.COMPLETED, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.COMPLETED]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.KYC_DELETION_PENDING],
  [ORDER_STATUS.DELIVERED]: [ORDER_STATUS.KYC_DELETION_PENDING, ORDER_STATUS.CLOSED],
  [ORDER_STATUS.KYC_DELETION_PENDING]: [ORDER_STATUS.CLOSED],
  [ORDER_STATUS.CLOSED]: [ORDER_STATUS.ARCHIVED],
  [ORDER_STATUS.ARCHIVED]: [],
  [ORDER_STATUS.CANCELLED]: [],
});

/**
 * Statuses considered "terminal" - no further transitions expected.
 */
const TERMINAL_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.CLOSED,
  ORDER_STATUS.ARCHIVED,
  ORDER_STATUS.CANCELLED,
]);

/**
 * Human-readable labels for client-facing display (Phase 6). One
 * presentation layer, reused by every client-safe serializer/endpoint
 * instead of formatting status strings ad hoc in multiple places.
 */
const ORDER_STATUS_LABELS = Object.freeze({
  [ORDER_STATUS.CREATED]: 'Order Created',
  [ORDER_STATUS.PAYMENT_PENDING]: 'Payment Pending',
  [ORDER_STATUS.PAYMENT_CONFIRMED]: 'Payment Confirmed',
  [ORDER_STATUS.ASSIGNED]: 'Assigned',
  [ORDER_STATUS.KYC_PENDING]: 'Documents Pending',
  [ORDER_STATUS.KYC_SUBMITTED]: 'Documents Uploaded',
  [ORDER_STATUS.KYC_VERIFICATION]: 'Under Verification',
  [ORDER_STATUS.KYC_REJECTED]: 'Documents Rejected',
  [ORDER_STATUS.IN_PROGRESS]: 'Under Processing',
  [ORDER_STATUS.QUALITY_CHECK]: 'Quality Check',
  [ORDER_STATUS.COMPLETED]: 'Completed',
  [ORDER_STATUS.DELIVERED]: 'Delivered',
  [ORDER_STATUS.KYC_DELETION_PENDING]: 'Closing (Doc Cleanup)',
  [ORDER_STATUS.CLOSED]: 'Closed',
  [ORDER_STATUS.ARCHIVED]: 'Archived',
  [ORDER_STATUS.CANCELLED]: 'Cancelled',
});

/**
 * Statuses a CLIENT (not staff) may self-cancel from - only before any
 * operational work has actually started. Once an order is ASSIGNED or
 * further along, only staff can cancel it (via the existing internal
 * CANCEL_ORDER-gated endpoint), since reversing assigned/in-flight work
 * has side effects a client shouldn't trigger unilaterally.
 */
const CLIENT_CANCELLABLE_STATUSES = Object.freeze([
  ORDER_STATUS.CREATED,
  ORDER_STATUS.PAYMENT_PENDING,
  ORDER_STATUS.PAYMENT_CONFIRMED,
]);

module.exports = {
  ORDER_STATUS,
  ALL_ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  CLIENT_CANCELLABLE_STATUSES,
};
