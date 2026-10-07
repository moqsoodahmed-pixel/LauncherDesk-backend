const { ORDER_STATUS_TRANSITIONS, ORDER_STATUS, TERMINAL_ORDER_STATUSES, ORDER_STATUS_LABELS } = require('../../constants/portal/orderStatus');
const { ORDER_PAYMENT_STATUS } = require('../../constants/portal/orderPaymentStatus');
const { Order, OrderStatusHistory } = require('../../models/portal');
const Service = require('../../models/portal/Service.model');
const AppError = require('../../utils/portal/AppError');
const { logAudit } = require('./auditLog.service');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const communicationService = require('./communication.service');
const notificationEventsService = require('./notificationEvents.service');
const { autoCreateTasksForStatus } = require('./task.service');
const logger = require('../../utils/portal/logger');

/**
 * The ONLY sanctioned way to change an order's status. Every controller
 * that moves an order forward must call this rather than setting
 * order.status directly, so the transition graph and history logging
 * stay centralized and consistent.
 */
async function transitionOrderStatus({ orderId, toStatus, changedBy, reason = null }) {
  const order = await Order.findById(orderId);
  if (!order) {
    throw AppError.notFound('Order not found.');
  }

  const fromStatus = order.status;

  if (TERMINAL_ORDER_STATUSES.includes(fromStatus)) {
    throw AppError.invalidStateTransition(`Order is already in a terminal state (${fromStatus}) and cannot transition further.`);
  }

  const allowedNext = ORDER_STATUS_TRANSITIONS[fromStatus] || [];
  if (!allowedNext.includes(toStatus)) {
    throw AppError.invalidStateTransition(
      `Cannot transition order from ${fromStatus} to ${toStatus}. Allowed next states: ${allowedNext.join(', ') || 'none'}.`
    );
  }

  order.status = toStatus;
  if (toStatus === ORDER_STATUS.COMPLETED) order.completedAt = new Date();
  if (toStatus === ORDER_STATUS.CLOSED) order.closedAt = new Date();
  if (toStatus === ORDER_STATUS.PAYMENT_CONFIRMED && order.paymentStatus === ORDER_PAYMENT_STATUS.PENDING) {
    order.paymentStatus = ORDER_PAYMENT_STATUS.PAID;
  }
  // Set SLA deadline when the order is assigned if the service has slaDays
  if (toStatus === ORDER_STATUS.ASSIGNED && !order.slaDeadline) {
    try {
      const svc = await Service.findById(order.service, 'slaDays');
      if (svc?.slaDays) {
        const dl = new Date();
        dl.setDate(dl.getDate() + svc.slaDays);
        order.slaDeadline = dl;
        order.slaStatus = 'ON_TIME';
      }
    } catch (_) { /* non-blocking */ }
  }
  if ([ORDER_STATUS.COMPLETED, ORDER_STATUS.DELIVERED].includes(toStatus) && order.slaDeadline) {
    order.slaStatus = new Date() <= order.slaDeadline ? 'COMPLETED' : 'DELAYED';
  }
  await order.save();

  await OrderStatusHistory.create({
    order: order._id,
    fromStatus,
    toStatus,
    changedBy,
    reason,
  });

  await logAudit({
    actor: changedBy,
    action: AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { fromStatus, toStatus, reason },
  });

  // Single authoritative place for status-driven client communication -
  // every order status change funnels through this function, so an event
  // is never accidentally fired twice from two different call sites (see
  // Phase 9 spec §52). Never allowed to affect the transition itself: any
  // failure inside dispatchCommunicationEvent() is already swallowed by
  // communication.service.js, but this is wrapped again here defensively
  // since notifyStatusChange() runs AFTER the state change has already
  // been persisted and committed.
  await notifyStatusChange(order, fromStatus, toStatus).catch((err) => {
    logger.error(`[orderStateMachine] Communication/notification dispatch threw unexpectedly: ${err.message}`);
  });

  // Auto-create workflow tasks for this status transition. Never blocks.
  autoCreateTasksForStatus(order, toStatus).catch((err) => {
    logger.error(`[orderStateMachine] autoCreateTasksForStatus threw: ${err.message}`);
  });

  return order;
}

// Single authoritative hook for BOTH Phase 9 (email/WhatsApp/SMS) and
// Phase 10 (in-app notification) dispatch - every order status change
// funnels through transitionOrderStatus(), so neither system is ever
// triggered from a second call site for the same event.
async function notifyStatusChange(order, fromStatus, toStatus) {
  if (toStatus === ORDER_STATUS.PAYMENT_PENDING) {
    return communicationService.sendOrderPaymentPending(order);
  }
  if (toStatus === ORDER_STATUS.PAYMENT_CONFIRMED) {
    await notificationEventsService.notifyOrderPaymentConfirmed(order).catch(() => {});
    return communicationService.sendOrderPaymentConfirmed(order);
  }
  if (toStatus === ORDER_STATUS.CANCELLED) {
    await notificationEventsService.notifyOrderCancelled(order).catch(() => {});
    return communicationService.sendOrderCancelled(order);
  }
  if (toStatus === ORDER_STATUS.COMPLETED) {
    await notificationEventsService.notifyOrderCompleted(order).catch(() => {});
    return communicationService.sendOrderCompleted(order);
  }
  if (toStatus === ORDER_STATUS.CLOSED) {
    await notificationEventsService.notifyOrderClosed(order).catch(() => {});
    return communicationService.sendOrderClosed(order);
  }
  if (toStatus === ORDER_STATUS.KYC_REJECTED) {
    await notificationEventsService.notifyKycRejected(order).catch(() => {});
    return communicationService.sendKycRejected(order);
  }
  if (toStatus === ORDER_STATUS.KYC_SUBMITTED) {
    await notificationEventsService.notifyKycSubmitted(order).catch(() => {});
    return communicationService.sendKycSubmitted(order);
  }
  if (toStatus === ORDER_STATUS.IN_PROGRESS && fromStatus === ORDER_STATUS.KYC_VERIFICATION) {
    await notificationEventsService.notifyKycVerified(order).catch(() => {});
    return communicationService.sendKycVerified(order);
  }
  // Fallback: a plain status-changed notice for any other transition not
  // specifically mapped above (e.g. ASSIGNED, KYC_PENDING) - distinct from
  // the internal ORDER_ASSIGNED admin notification (orderAssignment.service.js),
  // which has a different recipient/purpose entirely.
  await notificationEventsService.notifyOrderStatusChanged(order, ORDER_STATUS_LABELS[toStatus] || toStatus).catch(() => {});
  return communicationService.sendOrderStatusChanged(order, ORDER_STATUS_LABELS[toStatus] || toStatus);
}

function getAllowedNextStatuses(currentStatus) {
  return ORDER_STATUS_TRANSITIONS[currentStatus] || [];
}

module.exports = { transitionOrderStatus, getAllowedNextStatuses };
