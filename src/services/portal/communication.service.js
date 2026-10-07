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
async function dispatchCommunicationEvent({ eventType, channel, to, order = null, client = null, variables = {}, idempotencySuffix = null, meta = {} }) {
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

async function sendKycVerified(order) {
  const vars = { clientName: order.clientSnapshot?.name, orderNumber: order.orderCode, orderUrl: orderUrl(order._id) };
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.KYC_VERIFIED, channel: COMMUNICATION_CHANNEL.EMAIL, to: order.clientSnapshot?.email, order, variables: vars });
  await dispatchCommunicationEvent({ eventType: COMMUNICATION_EVENT.KYC_VERIFIED, channel: COMMUNICATION_CHANNEL.WHATSAPP, to: order.clientSnapshot?.phone, order, variables: vars });
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
  sendKycVerified,
  sendPaymentRefunded,
};
