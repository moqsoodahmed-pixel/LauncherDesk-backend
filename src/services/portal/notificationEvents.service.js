const { Client, User } = require('../../models/portal');
const notificationService = require('./notification.service');
const { NOTIFICATION_EVENT } = require('../../constants/portal/notificationEvents');
const { NOTIFICATION_SEVERITY } = require('../../constants/portal/notificationSeverity');
const { ROLES } = require('../../constants/portal/roles');

/** Sends a notification to all Super Admins except the actor (no self-notifications). */
async function notifySuperAdmins({ actorId, type, title, message, severity, relatedResourceType, relatedResourceId, idempotencySuffix } = {}) {
  const superAdmins = await User.find({ role: ROLES.SUPER_ADMIN, status: 'ACTIVE' }).select('_id');
  return Promise.all(
    superAdmins
      .filter((u) => !actorId || String(u._id) !== String(actorId))
      .map((u) =>
        notificationService.createNotification({
          recipientUserId: u._id,
          type,
          title,
          message,
          severity,
          relatedResourceType,
          relatedResourceId,
          idempotencySuffix: idempotencySuffix ? `${idempotencySuffix}:${u._id}` : undefined,
        }).catch(() => {})
      )
  );
}

/**
 * Per-event convenience wrappers, mirroring communication.service.js's
 * design exactly: each function resolves its own recipient(s) server-side
 * and is called from the SAME authoritative single-emission location
 * already used for the Phase 9 communication dispatch for that event -
 * never a second/parallel trigger site.
 */

async function clientUserId(clientId) {
  if (!clientId) return null;
  const client = await Client.findById(clientId).select('user');
  return client?.user || null;
}

async function notifyOrderCreated(order) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.ORDER_CREATED,
    title: 'Order received',
    message: `Your order ${order.orderCode} has been received.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
  });
}

async function notifyOrderPaymentConfirmed(order, actorId) {
  const recipientUserId = await clientUserId(order.client);
  const [, superAdminNotifs] = await Promise.all([
    notificationService.createNotification({
      recipientUserId,
      type: NOTIFICATION_EVENT.ORDER_PAYMENT_CONFIRMED,
      severity: NOTIFICATION_SEVERITY.SUCCESS,
      title: 'Payment confirmed',
      message: `Payment for order ${order.orderCode} has been confirmed.`,
      relatedResourceType: 'Order',
      relatedResourceId: order._id,
      order,
    }),
    notifySuperAdmins({
      actorId,
      type: NOTIFICATION_EVENT.ORDER_PAYMENT_CONFIRMED,
      severity: NOTIFICATION_SEVERITY.SUCCESS,
      title: `Payment received — ${order.orderCode}`,
      message: `A payment has been confirmed for order ${order.orderCode}.`,
      relatedResourceType: 'Order',
      relatedResourceId: order._id,
      idempotencySuffix: String(order._id),
    }),
  ]);
  return superAdminNotifs;
}

async function notifyOrderPaymentFailed(order) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.ORDER_PAYMENT_FAILED,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: 'Payment unsuccessful',
    message: `A payment attempt for order ${order.orderCode} was not successful.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
    // Payment attempts can legitimately fail more than once for the same
    // order - key by attempt moment (now) so each failure is its own
    // notification rather than collapsing into a single stale one.
    idempotencySuffix: String(Date.now()),
  });
}

async function notifyOrderAssigned(order, admin, actorId) {
  // Skip self-notification: actor assigned the order to themselves.
  if (actorId && String(admin._id) === String(actorId)) return null;
  return notificationService.createNotification({
    recipientUserId: admin._id,
    type: NOTIFICATION_EVENT.ORDER_ASSIGNED,
    title: 'Order assigned to you',
    message: `Order ${order.orderCode} has been assigned to you.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
    idempotencySuffix: String(admin._id),
  });
}

async function notifyOrderReassigned(order, newAdmin, actorId) {
  if (actorId && String(newAdmin._id) === String(actorId)) return null;
  return notificationService.createNotification({
    recipientUserId: newAdmin._id,
    type: NOTIFICATION_EVENT.ORDER_REASSIGNED,
    title: 'Order reassigned to you',
    message: `Order ${order.orderCode} has been reassigned to you.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
    idempotencySuffix: String(newAdmin._id),
  });
}

async function notifyOrderStatusChanged(order, statusLabel) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.ORDER_STATUS_CHANGED,
    title: 'Order status updated',
    message: `Order ${order.orderCode} is now ${statusLabel}.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
    idempotencySuffix: statusLabel,
  });
}

async function notifyOrderCancelled(order) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.ORDER_CANCELLED,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: 'Order cancelled',
    message: `Order ${order.orderCode} has been cancelled.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
  });
}

async function notifyOrderCompleted(order) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.ORDER_COMPLETED,
    severity: NOTIFICATION_SEVERITY.SUCCESS,
    title: 'Order completed',
    message: `Order ${order.orderCode} is now complete.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
  });
}

async function notifyOrderClosed(order) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.ORDER_CLOSED,
    title: 'Order closed',
    message: `Order ${order.orderCode} has been closed.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
  });
}

async function notifyKycSubmitted(order, actorId) {
  const results = [];
  if (order.assignedAdmin && String(order.assignedAdmin) !== String(actorId)) {
    results.push(
      notificationService.createNotification({
        recipientUserId: order.assignedAdmin,
        type: NOTIFICATION_EVENT.KYC_SUBMITTED,
        title: 'KYC submitted for review',
        message: `Order ${order.orderCode}'s KYC documents are ready for review.`,
        relatedResourceType: 'Order',
        relatedResourceId: order._id,
        order,
      })
    );
  }
  results.push(
    notifySuperAdmins({
      actorId,
      type: NOTIFICATION_EVENT.KYC_SUBMITTED,
      title: `KYC submitted — ${order.orderCode}`,
      message: `KYC documents for order ${order.orderCode} await review.`,
      relatedResourceType: 'Order',
      relatedResourceId: order._id,
      idempotencySuffix: String(order._id),
    })
  );
  return Promise.all(results);
}

async function notifyKycRejected(order) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.KYC_REJECTED,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: 'KYC action required',
    message: `Your KYC documents for order ${order.orderCode} need attention.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
  });
}

async function notifyKycVerified(order) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.KYC_VERIFIED,
    severity: NOTIFICATION_SEVERITY.SUCCESS,
    title: 'KYC verified',
    message: `Your KYC documents for order ${order.orderCode} have been verified.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
  });
}

async function notifyKycDocumentRejected(order, document) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.KYC_DOCUMENT_REJECTED,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: 'Document needs attention',
    message: `Your ${document.documentType} for order ${order.orderCode} could not be accepted.`,
    relatedResourceType: 'KycDocument',
    relatedResourceId: document._id,
    order,
    idempotencySuffix: `${document._id}:${document.version}`,
  });
}

async function notifyPaymentRefunded(order) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.PAYMENT_REFUNDED,
    title: 'Refund processed',
    message: `A refund has been processed for order ${order.orderCode}.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
  });
}

async function notifyClientCreated(client, actorId) {
  const results = [];
  if (client.user) {
    results.push(
      notificationService.createNotification({
        recipientUserId: client.user,
        type: NOTIFICATION_EVENT.CLIENT_CREATED,
        severity: NOTIFICATION_SEVERITY.SUCCESS,
        title: 'Welcome to LauncherDesk',
        message: 'Your account has been created.',
        relatedResourceType: 'Client',
        relatedResourceId: client._id,
        client,
      })
    );
  }
  results.push(
    notifySuperAdmins({
      actorId,
      type: NOTIFICATION_EVENT.CLIENT_CREATED,
      title: `New client registered — ${client.clientCode}`,
      message: `${client.name} has been registered as a new client.`,
      relatedResourceType: 'Client',
      relatedResourceId: client._id,
      idempotencySuffix: String(client._id),
    })
  );
  return Promise.all(results);
}

async function notifyClientStatusChanged(client, toStatus) {
  if (!client.user) return null;
  return notificationService.createNotification({
    recipientUserId: client.user,
    type: NOTIFICATION_EVENT.CLIENT_STATUS_CHANGED,
    severity: toStatus === 'ACTIVE' ? NOTIFICATION_SEVERITY.INFO : NOTIFICATION_SEVERITY.WARNING,
    title: 'Account status changed',
    message: `Your account status is now ${toStatus}.`,
    relatedResourceType: 'Client',
    relatedResourceId: client._id,
    client,
    idempotencySuffix: toStatus,
  });
}

async function notifyAdminCreated(admin) {
  return notificationService.createNotification({
    recipientUserId: admin._id,
    type: NOTIFICATION_EVENT.ADMIN_CREATED,
    severity: NOTIFICATION_SEVERITY.SUCCESS,
    title: 'Account created',
    message: 'Your LauncherDesk admin account has been created.',
    relatedResourceType: 'User',
    relatedResourceId: admin._id,
  });
}

async function notifyAdminStatusChanged(admin, toStatus) {
  const isEnabled = toStatus === 'ACTIVE';
  return notificationService.createNotification({
    recipientUserId: admin._id,
    type: isEnabled ? NOTIFICATION_EVENT.ADMIN_ENABLED : NOTIFICATION_EVENT.ADMIN_DISABLED,
    severity: isEnabled ? NOTIFICATION_SEVERITY.INFO : NOTIFICATION_SEVERITY.WARNING,
    title: isEnabled ? 'Account enabled' : 'Account disabled',
    message: isEnabled ? 'Your admin account has been re-enabled.' : 'Your admin account has been disabled.',
    relatedResourceType: 'User',
    relatedResourceId: admin._id,
    idempotencySuffix: toStatus,
  });
}

/** Security-critical - never suppressible (see MANDATORY_NOTIFICATION_EVENTS). */
async function notifyPasswordChanged(user) {
  return notificationService.createNotification({
    recipientUserId: user._id,
    type: NOTIFICATION_EVENT.PASSWORD_CHANGED,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: 'Password changed',
    message: 'Your password was recently changed. If this was not you, contact support immediately.',
    relatedResourceType: 'User',
    relatedResourceId: user._id,
    idempotencySuffix: String(Date.now()),
  });
}

/** Security-critical - never suppressible. */
async function notifySecurityEvent(userId, detail) {
  return notificationService.createNotification({
    recipientUserId: userId,
    type: NOTIFICATION_EVENT.SECURITY_EVENT,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    title: 'Security alert',
    message: detail,
    relatedResourceType: 'User',
    relatedResourceId: userId,
    idempotencySuffix: String(Date.now()),
  });
}

module.exports = {
  notifyOrderCreated,
  notifyOrderPaymentConfirmed,
  notifyOrderPaymentFailed,
  notifyOrderAssigned,
  notifyOrderReassigned,
  notifyOrderStatusChanged,
  notifyOrderCancelled,
  notifyOrderCompleted,
  notifyOrderClosed,
  notifyKycSubmitted,
  notifyKycRejected,
  notifyKycVerified,
  notifyKycDocumentRejected,
  notifyPaymentRefunded,
  notifyClientCreated,
  notifyClientStatusChanged,
  notifyAdminCreated,
  notifyAdminStatusChanged,
  notifyPasswordChanged,
  notifySecurityEvent,
};
