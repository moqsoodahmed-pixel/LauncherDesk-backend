const { CommunicationLog } = require('../../models/portal');
const { COMMUNICATION_CHANNEL } = require('../../constants/portal/communicationChannels');
const { COMMUNICATION_STATUS } = require('../../constants/portal/communicationStatus');
const { COMMUNICATION_EVENT } = require('../../constants/portal/communicationEvents');
const { getTemplate, sanitizeVariables } = require('../../communication/templates');
const { isValidEmail, normalizePhone } = require('../../utils/portal/contactValidation');
const { attemptDelivery } = require('./communicationProcessor.service');
const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');

function orderUrl(orderId) {
  return `${env.CLIENT_URL}/client/orders/${orderId}`;
}

/**
 * The ONE entry point every business service calls to trigger a
 * communication. Deliberately never throws - a communication failure (or
 * even a bug in this dispatch logic itself) must never roll back the
 * caller's business transaction (order/payment/KYC state). Callers simply
 * `await dispatchCommunicationEvent(...)` with no try/catch of their own.
 *
 * Idempotent via `idempotencyKey` (unique index on CommunicationLog): the
 * same logical event dispatched twice reuses the existing record instead
 * of sending twice, UNLESS that record already FAILED, in which case this
 * call is itself a deliberate retry and reuses the same record/identity
 * rather than creating a new one (per Phase 9 spec §21).
 */
async function dispatchCommunicationEvent({ eventType, channel, to, order = null, client = null, variables = {}, idempotencySuffix = null, meta = {}, attachmentStorageKey = null, attachmentFileName = null }) {
  try {
    const template = getTemplate(eventType);
    const channelKey = channel.toLowerCase();
    if (!template || !template.channels[channelKey]) {
      // Not every event sends on every channel - this is normal, not an error.
      return null;
    }

    if (channel === COMMUNICATION_CHANNEL.EMAIL) {
      if (!isValidEmail(to)) {
        logger.warn(`[communication] Skipping ${eventType}/EMAIL - no usable recipient email.`);
        return null;
      }
    } else {
      const normalized = normalizePhone(to);
      if (!normalized) {
        logger.warn(`[communication] Skipping ${eventType}/${channel} - no usable recipient phone number.`);
        return null;
      }
      to = normalized;
    }

    const cleanVariables = sanitizeVariables(eventType, variables);
    const idempotencyKey = [eventType, channel, order?._id || client?._id || 'none', idempotencySuffix].filter(Boolean).join(':');

    let log = await CommunicationLog.findOne({ idempotencyKey });
    if (log) {
      if ([COMMUNICATION_STATUS.SENT, COMMUNICATION_STATUS.DELIVERED].includes(log.status)) {
        return log; // already delivered - true idempotent no-op
      }
      if ([COMMUNICATION_STATUS.QUEUED, COMMUNICATION_STATUS.SENDING, COMMUNICATION_STATUS.RETRYING].includes(log.status)) {
        return log; // already in flight - never double-send
      }
      // FAILED - this call is a deliberate retry of the same logical event.
      log.status = COMMUNICATION_STATUS.QUEUED;
      log.to = to;
      log.variables = cleanVariables;
      log.failureReason = null;
      log.failedAt = null;
      log.nextAttemptAt = null;
      if (attachmentStorageKey) {
        log.attachmentStorageKey = attachmentStorageKey;
        log.attachmentFileName = attachmentFileName;
      }
      await log.save();
    } else {
      const provider = channel === COMMUNICATION_CHANNEL.EMAIL ? (env.BREVO_API_KEY ? 'BREVO' : 'DEVELOPMENT') : env.MSG91_AUTH_KEY ? 'MSG91' : 'DEVELOPMENT';
      log = await CommunicationLog.create({
        channel,
        eventType,
        to,
        order: order?._id || null,
        client: client?._id || order?.client || null,
        templateKey: eventType,
        subject: channelKey === 'email' ? template.channels.email.subject : null,
        variables: cleanVariables,
        provider,
        status: COMMUNICATION_STATUS.QUEUED,
        idempotencyKey,
        attachmentStorageKey,
        attachmentFileName,
      });
    }

    await attemptDelivery(log._id);
    return log;
  } catch (err) {
    // Never let a bug in dispatch logic itself escape to the caller either.
    logger.error(`[communication] dispatchCommunicationEvent failed for ${eventType}/${channel}: ${err.message}`);
    return null;
  }
}

// --- Convenience wrappers, one per business event, each resolving its own
// safe recipient/variables server-side. These are what order/payment/kyc
// services actually call - never a raw dispatchCommunicationEvent() with
// hand-built variables scattered through business code. ---

async function sendOrderCreated(order) {
  const vars = {
    clientName: order.clientSnapshot?.name,
    orderNumber: order.orderCode,
    serviceName: order.serviceSnapshot?.name,
    amount: order.pricing?.totalAmountMinor != null ? (order.pricing.totalAmountMinor / 100).toFixed(2) : null,
    currency: order.pricing?.currency,
    orderUrl: orderUrl(order._id),
  };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_CREATED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_CREATED, channel: COMMUNICATION_CHANNEL.WHATSAPP, to: order.clientSnapshot?.phone, order, variables: vars });
}

async function sendOrderPaymentPending(order) {
  const vars = {
    clientName: order.clientSnapshot?.name,
    orderNumber: order.orderCode,
    amount: order.pricing?.totalAmountMinor != null ? (order.pricing.totalAmountMinor / 100).toFixed(2) : null,
    currency: order.pricing?.currency,
    orderUrl: orderUrl(order._id),
  };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_PAYMENT_PENDING, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
}

async function sendOrderPaymentConfirmed(order, { paymentDate } = {}) {
  const vars = {
    clientName: order.clientSnapshot?.name,
    orderNumber: order.orderCode,
    amount: order.pricing?.totalAmountMinor != null ? (order.pricing.totalAmountMinor / 100).toFixed(2) : null,
    currency: order.pricing?.currency,
    paymentDate: (paymentDate || new Date()).toISOString().slice(0, 10),
    orderUrl: orderUrl(order._id),
    // Parts 4 & 5: the order's invoiceNumber is assigned at creation time
    // (idGenerator.service.js) and is already final by the time payment is
    // confirmed; invoiceUrl points at the existing print-to-PDF invoice page.
    invoiceNumber: order.invoiceNumber || null,
    invoiceUrl: `${env.CLIENT_URL}/client/orders/${order._id}/invoice`,
  };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_PAYMENT_CONFIRMED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_PAYMENT_CONFIRMED, channel: COMMUNICATION_CHANNEL.WHATSAPP, to: order.clientSnapshot?.phone, order, variables: vars });
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_PAYMENT_CONFIRMED, channel: COMMUNICATION_CHANNEL.SMS, to: order.clientSnapshot?.phone, order, variables: vars });
}

async function sendOrderPaymentFailed(order) {
  const vars = { clientName: order.clientSnapshot?.name, orderNumber: order.orderCode, orderUrl: orderUrl(order._id) };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_PAYMENT_FAILED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
}

async function sendOrderAssigned(order, admin) {
  const vars = { adminName: admin.name, orderNumber: order.orderCode, clientName: order.clientSnapshot?.name, orderUrl: `${env.CLIENT_URL}/admin/orders/${order._id}` };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_ASSIGNED, channel: COMMUNICATION_CHANNEL.EMAIL, to: admin.email, order, variables: vars, idempotencySuffix: String(admin._id) });
}

async function sendOrderStatusChanged(order, statusLabel) {
  const vars = { clientName: order.clientSnapshot?.name, orderNumber: order.orderCode, statusLabel, orderUrl: orderUrl(order._id) };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_STATUS_CHANGED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars, idempotencySuffix: statusLabel });
}

async function sendOrderCancelled(order) {
  const vars = { clientName: order.clientSnapshot?.name, orderNumber: order.orderCode, orderUrl: orderUrl(order._id) };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_CANCELLED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
}

async function sendOrderCompleted(order) {
  const vars = { clientName: order.clientSnapshot?.name, orderNumber: order.orderCode, serviceName: order.serviceSnapshot?.name, orderUrl: orderUrl(order._id) };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_COMPLETED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_COMPLETED, channel: COMMUNICATION_CHANNEL.WHATSAPP, to: order.clientSnapshot?.phone, order, variables: vars });
}

async function sendOrderClosed(order) {
  const vars = { clientName: order.clientSnapshot?.name, orderNumber: order.orderCode, orderUrl: orderUrl(order._id) };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.ORDER_CLOSED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
}

async function sendKycSubmitted(order) {
  const vars = { clientName: order.clientSnapshot?.name, orderNumber: order.orderCode, orderUrl: orderUrl(order._id) };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.KYC_SUBMITTED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
}

async function sendKycRejected(order) {
  const vars = { clientName: order.clientSnapshot?.name, orderNumber: order.orderCode, orderUrl: orderUrl(order._id) };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.KYC_REJECTED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.KYC_REJECTED, channel: COMMUNICATION_CHANNEL.WHATSAPP, to: order.clientSnapshot?.phone, order, variables: vars });
}

async function sendKycDocumentRejected(order, document) {
  const vars = {
    clientName: order.clientSnapshot?.name,
    orderNumber: order.orderCode,
    documentType: document.documentType,
    rejectionReason: document.rejectionReason,
    orderUrl: orderUrl(order._id),
  };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.KYC_DOCUMENT_REJECTED,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: order.clientSnapshot?.email,
    order,
    variables: vars,
    // Keyed by document+version: a different document, or a later version
    // of the SAME document being rejected again, is a genuinely new event,
    // never collapsed into the same idempotency record as the first.
    idempotencySuffix: `${document._id}:${document.version}`,
  });
}

/**
 * Wave 2 addition: fired from kyc.service.js's requestReupload, which
 * (per Wave 1's doc-comment) deliberately did NOT dispatch anything yet.
 * Mirrors sendKycDocumentRejected's exact structure/idempotency pattern.
 */
async function sendKycDocumentNeedReupload(order, document) {
  const vars = {
    clientName: order.clientSnapshot?.name,
    orderNumber: order.orderCode,
    documentType: document.documentType,
    reason: document.rejectionReason,
    orderUrl: orderUrl(order._id),
  };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.KYC_DOCUMENT_NEED_REUPLOAD,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: order.clientSnapshot?.email,
    order,
    variables: vars,
    idempotencySuffix: `${document._id}:${document.version}`,
  });
}

async function sendDocumentRequested(order, docRequest) {
  const vars = {
    clientName: order.clientSnapshot?.name,
    orderNumber: order.orderCode,
    documentLabel: docRequest.label || docRequest.documentType || 'a document',
    orderUrl: orderUrl(order._id),
  };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.DOCUMENT_REQUESTED,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: order.clientSnapshot?.email,
    order,
    variables: vars,
    idempotencySuffix: String(docRequest._id),
  });
}

async function sendDocumentFulfilled(order, docRequest) {
  const vars = {
    clientName: order.clientSnapshot?.name,
    orderNumber: order.orderCode,
    documentLabel: docRequest.label || docRequest.documentType || 'document',
    orderUrl: orderUrl(order._id),
  };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.DOCUMENT_FULFILLED,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: order.clientSnapshot?.email,
    order,
    variables: vars,
    idempotencySuffix: `fulfilled:${docRequest._id}`,
  });
}

async function sendKycVerified(order) {
  const vars = { clientName: order.clientSnapshot?.name, orderNumber: order.orderCode, orderUrl: orderUrl(order._id) };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.KYC_VERIFIED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.KYC_VERIFIED, channel: COMMUNICATION_CHANNEL.WHATSAPP, to: order.clientSnapshot?.phone, order, variables: vars });
}

/** Wave 2 addition: closes the gap where assignReviewer() only had an in-app notification. Mirrors sendOrderAssigned's internal-only, single-recipient shape. */
async function sendKycReviewerAssigned(order, document, reviewer) {
  const vars = {
    reviewerName: reviewer.name,
    orderNumber: order.orderCode,
    documentType: document.documentType,
    orderUrl: `${env.CLIENT_URL}/admin/orders/${order._id}`,
  };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.KYC_REVIEWER_ASSIGNED,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: reviewer.email,
    order,
    variables: vars,
    idempotencySuffix: `${document._id}:${reviewer._id}`,
  });
}

/**
 * Phase 11 addition: admin-facing-only alert for a detected virus/malware
 * upload - never sent to the client who uploaded the file. Not yet wired
 * to a real call site (the scan itself lives in kyc.service.js's upload
 * path, out of scope for this change - owned by a parallel AV/storage
 * workstream); ready for that workstream to call once a scan reports
 * !clean.
 */
async function sendVirusDetected(order, document, toEmail) {
  const vars = {
    orderNumber: order?.orderCode || 'unknown',
    documentType: document?.documentType || 'document',
    orderUrl: order?._id ? `${env.CLIENT_URL}/admin/orders/${order._id}` : env.CLIENT_URL,
  };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.VIRUS_DETECTED,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: toEmail,
    order,
    variables: vars,
    idempotencySuffix: `virus:${document?._id}:${Date.now()}`,
  });
}

async function sendPaymentRefunded(order, { amountPaise } = {}) {
  const vars = {
    clientName: order.clientSnapshot?.name,
    orderNumber: order.orderCode,
    amount: amountPaise != null ? (amountPaise / 100).toFixed(2) : null,
    currency: order.pricing?.currency,
    orderUrl: orderUrl(order._id),
  };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.PAYMENT_REFUNDED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
}

/** Part 1 of the transactional-email brief: fired once, the moment a CLIENT portal_user is first created. */
async function sendClientWelcome(portalUser, client) {
  const vars = {
    clientName: portalUser.name,
    clientCode: client?.clientCode || null,
    email: portalUser.email,
    registeredDate: (portalUser.createdAt || new Date()).toISOString().slice(0, 10),
    status: portalUser.status,
    loginUrl: `${env.CLIENT_URL}/user/login`,
  };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.CLIENT_WELCOME,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: portalUser.email,
    client,
    variables: vars,
  });
}

/** Part 2: fired when a Super Admin creates a new Admin via admins.service.js createAdmin(). */
async function sendAdminCreated(admin) {
  const vars = {
    adminName: admin.name,
    adminCode: admin.adminCode || null,
    email: admin.email,
    role: admin.role,
    loginUrl: `${env.CLIENT_URL}/user/login`,
  };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.ADMIN_CREATED,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: admin.email,
    variables: vars,
    idempotencySuffix: String(admin._id),
  });
}

/** Part 6 (client-facing half): "You have been assigned an Account Manager." */
async function sendClientAssignedAdminNotice(client, clientUserEmail, admin) {
  const vars = { clientName: client.name, adminName: admin.name, adminEmail: admin.email };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.CLIENT_ASSIGNED_ADMIN,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: clientUserEmail,
    client,
    variables: vars,
    // Re-assignment to a different admin is a distinct event from the first
    // assignment - keyed by which admin, so switching admins re-notifies.
    idempotencySuffix: String(admin._id),
  });
}

/** Part 6 (admin-facing half): "New Client Assigned". */
async function sendAdminClientAssignedNotice(admin, client) {
  const vars = {
    adminName: admin.name,
    clientName: client.name,
    clientCode: client.clientCode,
    clientEmail: client.email,
    clientPhone: client.phone || 'Not provided',
    companyName: client.companyName || client.name,
    assignedDate: new Date().toISOString().slice(0, 10),
    clientUrl: `${env.CLIENT_URL}/${admin.role === 'SUPER_ADMIN' ? 'super-admin' : 'admin'}/clients/${client._id}`,
  };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.ADMIN_CLIENT_ASSIGNED,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: admin.email,
    client,
    variables: vars,
    // Same client assigned to the same admin a second time (e.g. a
    // double-submit) is a no-op, never a second email - keyed by the pair,
    // not by time.
    idempotencySuffix: String(admin._id),
  });
}

/**
 * Part 5 (email) of the invoice-generation brief: fired once per Invoice
 * record, PDF attached.
 *
 * `resendSuffix`: omitted for the one automatic send that happens the
 * moment a payment is confirmed (idempotencySuffix keyed by invoice._id
 * alone, so a double-fired payment-confirmation event can never send the
 * same invoice email twice). An explicit admin "Resend Email" action,
 * however, is a deliberate, one-off command - if it reused that same key,
 * dispatchCommunicationEvent would see the original send as already
 * SENT and silently no-op, so "Resend" would never actually resend
 * anything. Passing a fresh, time-based suffix here makes a resend its
 * own distinct, fully logged CommunicationLog record every time.
 */
async function sendInvoiceGenerated(order, invoice, { resend = false } = {}) {
  const vars = {
    customerName: invoice.billingSnapshot.customerName,
    orderCode: order.orderCode,
    invoiceNumber: invoice.invoiceNumber,
    amountPaid: (invoice.billingSnapshot.totalAmountMinor / 100).toFixed(2),
    currency: invoice.billingSnapshot.currency,
    paymentStatus: 'PAID',
    invoiceUrl: `${env.CLIENT_URL}/client/invoices/${invoice._id}`,
  };
  await dispatchCommunicationEvent({
    eventType: COMMUNICATION_EVENT.INVOICE_GENERATED,
    channel: COMMUNICATION_CHANNEL.EMAIL,
    to: invoice.billingSnapshot.customerEmail,
    order,
    client: invoice.client,
    variables: vars,
    idempotencySuffix: resend ? `resend:${Date.now()}` : String(invoice._id),
    attachmentStorageKey: invoice.storageKey,
    attachmentFileName: invoice.originalFileName,
  });
}

module.exports = {
  dispatchCommunicationEvent,
  sendOrderCreated,
  sendOrderPaymentPending,
  sendOrderPaymentConfirmed,
  sendOrderPaymentFailed,
  sendOrderAssigned,
  sendOrderStatusChanged,
  sendOrderCancelled,
  sendOrderCompleted,
  sendOrderClosed,
  sendKycSubmitted,
  sendKycRejected,
  sendKycDocumentRejected,
  sendKycDocumentNeedReupload,
  sendDocumentRequested,
  sendDocumentFulfilled,
  sendKycVerified,
  sendKycReviewerAssigned,
  sendVirusDetected,
  sendPaymentRefunded,
  sendClientWelcome,
  sendAdminCreated,
  sendClientAssignedAdminNotice,
  sendAdminClientAssignedNotice,
  sendInvoiceGenerated,
};
