const { Client, User } = require('../../models/portal');
const notificationService = require('./notification.service');
const { NOTIFICATION_EVENT } = require('../../constants/portal/notificationEvents');
const { NOTIFICATION_SEVERITY } = require('../../constants/portal/notificationSeverity');
const { ROLES } = require('../../constants/portal/roles');
// Phase 11 (smart notification): the CTO direct-email escalation rides the
// existing Brevo/communication machinery - never a second ad-hoc email
// sender. communication.service.js is required lazily (inside the one
// function that needs it, below) rather than at module top-level:
// communicationProcessor.service.js (required by communication.service.js)
// already requires THIS module, so a top-level require here would create
// a require cycle and risk communicationProcessor getting a stale, empty
// reference to this module's exports depending on load order.
const { COMMUNICATION_EVENT } = require('../../constants/portal/communicationEvents');
const { COMMUNICATION_CHANNEL } = require('../../constants/portal/communicationChannels');
const env = require('../../config/portal');

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

async function notifyOrderCreated(order, actorId) {
  const recipientUserId = await clientUserId(order.client);
  const [, superAdminNotifs] = await Promise.all([
    notificationService.createNotification({
      recipientUserId,
      type: NOTIFICATION_EVENT.ORDER_CREATED,
      title: 'Order received',
      message: `Your order ${order.orderCode} has been received.`,
      relatedResourceType: 'Order',
      relatedResourceId: order._id,
      order,
    }),
    // Part 3 gap: Super Admins previously had no visibility into new orders
    // at all until payment was confirmed - mirrors the existing
    // notifyOrderPaymentConfirmed() fan-out pattern exactly.
    notifySuperAdmins({
      actorId,
      type: NOTIFICATION_EVENT.ORDER_CREATED,
      title: `New order — ${order.orderCode}`,
      message: `A new order has been placed: ${order.orderCode} (${order.serviceSnapshot?.name || 'service'}).`,
      relatedResourceType: 'Order',
      relatedResourceId: order._id,
      idempotencySuffix: String(order._id),
    }),
  ]);
  return superAdminNotifs;
}

/**
 * Phase 11 (smart notification) rework: the moment a payment is confirmed
 * is the single authoritative point to decide whether this order needs
 * urgent human triage.
 *  - Order already has an assigned admin -> that admin alone is notified
 *    (they are already the right owner; no Super Admin fan-out, no CTO
 *    email - see notifyAssignedAdminOrderPaid()).
 *  - Order has NO assigned admin -> this is an operational gap: all Super
 *    Admins get a CRITICAL, "stays visible until resolved" notification,
 *    plus a direct CTO email if one is configured (see
 *    notifySuperAdminsOrderPaidAwaitingAssignment()).
 * This replaces the previous unconditional "every Super Admin gets a
 * plain SUCCESS payment-received notification" behavior - that broadcast
 * added no value once an order already has an owner, and actively
 * buried the one case (no owner) that genuinely needs attention.
 */
async function notifyOrderPaymentConfirmed(order, actorId) {
  const recipientUserId = await clientUserId(order.client);
  const clientNotifPromise = notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.ORDER_PAYMENT_CONFIRMED,
    severity: NOTIFICATION_SEVERITY.SUCCESS,
    title: 'Payment confirmed',
    message: `Payment for order ${order.orderCode} has been confirmed.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
  });

  const escalationPromise = order.assignedAdmin
    ? notifyAssignedAdminOrderPaid(order)
    : notifySuperAdminsOrderPaidAwaitingAssignment(order, actorId);

  const [, escalationResult] = await Promise.all([clientNotifPromise, escalationPromise]);
  return escalationResult;
}

/** Single-recipient notifier for an order that is paid AND already has an assigned admin - mirrors notifyOrderAssigned's single-recipient pattern. */
async function notifyAssignedAdminOrderPaid(order) {
  if (!order.assignedAdmin) return null;
  return notificationService.createNotification({
    recipientUserId: order.assignedAdmin,
    type: NOTIFICATION_EVENT.ORDER_PAYMENT_CONFIRMED,
    severity: NOTIFICATION_SEVERITY.SUCCESS,
    title: `Payment confirmed — ${order.orderCode}`,
    message: `Payment for your assigned order ${order.orderCode} has been confirmed.`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
    // Scoped to this order+admin so a retried webhook/transition can never
    // create a second copy of the same logical notification.
    idempotencySuffix: `assigned-admin:${order.assignedAdmin}`,
  });
}

/**
 * High-priority escalation for a paid order with no assigned admin yet.
 * Stays "open" (resolved: false) until an admin is actually assigned - see
 * resolvePaidAwaitingAssignment(), called from orderAssignment.service.js.
 *
 * CTO email: there is no CTO role in this system (confirmed against
 * constants/portal/roles.js - only SUPER_ADMIN/ADMIN/CLIENT exist), so
 * "notify the CTO" is implemented as a direct email to an operator-
 * configured address (CTO_NOTIFICATION_EMAIL), not a role-based recipient
 * list. If that env var is unset, the CTO email is silently skipped - this
 * is a deliberate judgment call: an unconfigured optional escalation
 * channel is not an error, and Super Admins already received the in-app
 * CRITICAL alert above regardless.
 */
async function notifySuperAdminsOrderPaidAwaitingAssignment(order, actorId) {
  const result = await notifySuperAdmins({
    actorId,
    type: NOTIFICATION_EVENT.ORDER_PAID_AWAITING_ASSIGNMENT,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    title: `Paid order awaiting admin assignment — ${order.orderCode}`,
    message: 'New paid order is waiting for admin assignment.',
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    idempotencySuffix: `awaiting-assignment:${order._id}`,
  });

  const ctoEmail = (process.env.CTO_NOTIFICATION_EMAIL || '').trim();
  if (ctoEmail) {
    // Required lazily - see the top-of-file note on why this can't be a
    // top-level require.
    await require('./communication.service')
      .dispatchCommunicationEvent({
        eventType: COMMUNICATION_EVENT.ORDER_PAID_AWAITING_ASSIGNMENT,
        channel: COMMUNICATION_CHANNEL.EMAIL,
        to: ctoEmail,
        order,
        variables: {
          orderNumber: order.orderCode,
          orderUrl: `${env.CLIENT_URL}/admin/orders/${order._id}`,
        },
        // Scoped to this order - a retried webhook/transition never sends
        // the CTO a second copy of the same escalation email.
        idempotencySuffix: `cto:${order._id}`,
      })
      .catch(() => {});
  }

  return result;
}

/** Phase 11: marks every pending ORDER_PAID_AWAITING_ASSIGNMENT notification for this order as resolved - called once, the moment an admin is actually assigned to a paid order (orderAssignment.service.js). */
async function resolvePaidAwaitingAssignment(orderId) {
  return notificationService.resolveNotificationsForOrder(orderId, NOTIFICATION_EVENT.ORDER_PAID_AWAITING_ASSIGNMENT);
}

/**
 * Fired IN ADDITION to the generic notifyOrderAssigned() when - and only
 * when - the order being assigned was ALREADY paid at assignment time
 * (the "paid-then-later-assigned" escalation sequence). An order assigned
 * before payment ever completed never reaches this function - that stays
 * on the normal, unchanged notifyOrderAssigned() path.
 */
async function notifyAdminAssignedPaidOrder(order, admin) {
  return notificationService.createNotification({
    recipientUserId: admin._id,
    type: NOTIFICATION_EVENT.ORDER_PAID_ADMIN_ASSIGNED,
    severity: NOTIFICATION_SEVERITY.SUCCESS,
    title: 'Paid order assigned to you',
    message: 'You have been assigned a new paid client order.',
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    order,
    idempotencySuffix: `paid-assigned:${admin._id}`,
  });
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

/** Wave 2 addition: mirrors notifyKycDocumentRejected's exact pattern. */
async function notifyKycDocumentNeedsReupload(order, document) {
  const recipientUserId = await clientUserId(order.client);
  return notificationService.createNotification({
    recipientUserId,
    type: NOTIFICATION_EVENT.KYC_DOCUMENT_NEED_REUPLOAD,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: 'Document needs to be re-uploaded',
    message: `Your ${document.documentType} for order ${order.orderCode} needs to be re-uploaded.`,
    relatedResourceType: 'KycDocument',
    relatedResourceId: document._id,
    order,
    idempotencySuffix: `${document._id}:${document.version}`,
  });
}

/** Wave 2 addition: mirrors notifyOrderAssigned's exact single-recipient pattern. */
async function notifyKycReviewerAssigned(document, reviewer, actorId) {
  if (actorId && String(reviewer._id) === String(actorId)) return null; // no self-notification
  return notificationService.createNotification({
    recipientUserId: reviewer._id,
    type: NOTIFICATION_EVENT.KYC_REVIEWER_ASSIGNED,
    title: 'KYC document assigned to you',
    message: `A ${document.documentType} document has been assigned to you for review.`,
    relatedResourceType: 'KycDocument',
    relatedResourceId: document._id,
    idempotencySuffix: String(reviewer._id),
  });
}

async function notifyPaymentRefunded(order, actorId) {
  const recipientUserId = await clientUserId(order.client);
  const [clientNotif] = await Promise.all([
    notificationService.createNotification({
      recipientUserId,
      type: NOTIFICATION_EVENT.PAYMENT_REFUNDED,
      title: 'Refund processed',
      message: `A refund has been processed for order ${order.orderCode}.`,
      relatedResourceType: 'Order',
      relatedResourceId: order._id,
      order,
    }),
    // Part 3 gap: admins previously had zero visibility into refunds.
    notifySuperAdmins({
      actorId,
      type: NOTIFICATION_EVENT.PAYMENT_REFUNDED,
      title: `Refund processed — ${order.orderCode}`,
      message: `A refund was processed for order ${order.orderCode}.`,
      relatedResourceType: 'Order',
      relatedResourceId: order._id,
      idempotencySuffix: `refund:${order._id}:${Date.now()}`,
    }),
  ]);
  return clientNotif;
}

async function notifySupportTicketCreated(ticket, actorId) {
  return notifySuperAdmins({
    actorId,
    type: NOTIFICATION_EVENT.SUPPORT_TICKET_CREATED,
    title: `New support ticket — ${ticket.subject || ticket.ticketCode || ''}`.trim(),
    message: `A new support ticket has been raised${ticket.ticketCode ? ` (${ticket.ticketCode})` : ''}.`,
    relatedResourceType: 'SupportTicket',
    relatedResourceId: ticket._id,
    idempotencySuffix: String(ticket._id),
  });
}

async function notifyInvoiceFailed(order, error) {
  return notifySuperAdmins({
    type: NOTIFICATION_EVENT.INVOICE_GENERATION_FAILED,
    severity: NOTIFICATION_SEVERITY.ERROR,
    title: `Invoice generation failed — ${order.orderCode}`,
    message: `Invoice generation failed for order ${order.orderCode}: ${error?.message || 'Unknown error'}`,
    relatedResourceType: 'Order',
    relatedResourceId: order._id,
    idempotencySuffix: `invoice-fail:${order._id}:${Date.now()}`,
  });
}

async function notifyEmailFailed(log) {
  return notifySuperAdmins({
    type: NOTIFICATION_EVENT.EMAIL_DELIVERY_FAILED,
    severity: NOTIFICATION_SEVERITY.ERROR,
    title: `Email delivery failed — ${log.eventType || ''}`.trim(),
    message: `Delivery failed for ${log.eventType || 'a notification'} to ${log.to || 'recipient'}: ${log.failureReason || 'Unknown error'}`,
    relatedResourceType: 'CommunicationLog',
    relatedResourceId: log._id,
    idempotencySuffix: `email-fail:${log._id}`,
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

/**
 * Admin-facing-only alert for a detected virus/malware on an uploaded
 * file - never sent to the client who uploaded it (a detected virus is an
 * internal security event, not something to disclose to the uploader).
 * Mirrors notifyInvoiceFailed's admin-alert pattern exactly.
 *
 * NOT YET WIRED to a call site: the actual scan happens in
 * kyc.service.js's upload path (around getAntivirusProvider().scan()),
 * which is explicitly out of scope for this change (owned by a parallel
 * ClamAV/Cloudinary/hashing workstream). This function + its email
 * counterpart (communication.service.js's sendVirusDetected) are ready for
 * that workstream (or a follow-up change) to call once a scan reports
 * !clean, following AUDIT_ACTIONS.KYC_VIRUS_DETECTED for the audit entry.
 */
async function notifyVirusDetected(order, document) {
  return notifySuperAdmins({
    type: NOTIFICATION_EVENT.VIRUS_DETECTED,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    title: `Virus detected in upload — ${order?.orderCode || ''}`.trim(),
    message: `A file upload for order ${order?.orderCode || 'unknown'} (${document?.documentType || 'document'}) failed a security scan and was blocked.`,
    relatedResourceType: 'KycDocument',
    relatedResourceId: document?._id,
    idempotencySuffix: `virus:${document?._id}:${Date.now()}`,
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
  notifyAssignedAdminOrderPaid,
  notifySuperAdminsOrderPaidAwaitingAssignment,
  resolvePaidAwaitingAssignment,
  notifyAdminAssignedPaidOrder,
  notifyVirusDetected,
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
  notifyKycDocumentNeedsReupload,
  notifyKycReviewerAssigned,
  notifyPaymentRefunded,
  notifyClientCreated,
  notifyClientStatusChanged,
  notifyAdminCreated,
  notifyAdminStatusChanged,
  notifyPasswordChanged,
  notifySecurityEvent,
  notifySupportTicketCreated,
  notifyInvoiceFailed,
  notifyEmailFailed,
  notifySuperAdmins,
};
