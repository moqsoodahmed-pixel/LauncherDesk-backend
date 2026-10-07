const { Payment, PaymentWebhookEvent } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { getPaymentProvider } = require('../../adapters/payment');
const { PAYMENT_ATTEMPT_STATUS } = require('../../constants/portal/paymentAttemptStatus');
const { generatePaymentCode } = require('./idGenerator.service');
const { ORDER_PAYMENT_STATUS, isValidPaymentStatusTransition } = require('../../constants/portal/orderPaymentStatus');
const { ORDER_STATUS } = require('../../constants/portal/orderStatus');
const { transitionOrderStatus } = require('./orderStateMachine.service');
const { logAudit } = require('./auditLog.service');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const communicationService = require('./communication.service');
const notificationEventsService = require('./notificationEvents.service');
const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');

function auditCtx(actor) {
  return actor ? { actor: actor._id, actorRole: actor.role } : { actor: null, actorRole: 'SYSTEM' };
}

/** Internal shape (Admin/Super Admin). Never includes providerSignature. */
function serializePaymentForInternal(payment) {
  return {
    id: payment._id,
    paymentCode: payment.paymentCode ?? null,
    order: payment.order,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId,
    amountPaise: payment.amountPaise,
    currency: payment.currency,
    status: payment.status,
    method: payment.method,
    signatureVerified: payment.signatureVerified,
    captured: payment.captured,
    failedAt: payment.failedAt,
    failureReason: payment.failureReason,
    paidAt: payment.paidAt,
    refundedAt: payment.refundedAt,
    refundAmountPaise: payment.refundAmountPaise,
    attemptNumber: payment.attemptNumber,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/** Client-safe shape: no internal provider order/payment ids beyond what checkout already gave the client, no signature, no raw provider references. */
function serializePaymentForClient(payment) {
  if (!payment) return null;
  return {
    status: payment.status,
    amountPaise: payment.amountPaise,
    currency: payment.currency,
    method: payment.method,
    paidAt: payment.paidAt,
    failureReason: payment.failedAt ? payment.failureReason : null,
    refundedAt: payment.refundedAt,
    refundAmountPaise: payment.refundAmountPaise,
  };
}

async function getLatestPayment(orderId) {
  return Payment.findOne({ order: orderId }).sort({ attemptNumber: -1 });
}

/**
 * Creates (or safely reuses) a Razorpay order for this Order's payment.
 * Idempotent: a repeated call while an attempt is still CREATED (checkout
 * not yet completed/failed) returns that SAME attempt rather than creating
 * a new provider order every time the client retries the request.
 */
async function createPaymentOrder({ order, actor, meta = {} }) {
  if (order.paymentStatus === ORDER_PAYMENT_STATUS.NOT_REQUIRED) {
    throw AppError.badRequest('This order does not require payment.');
  }
  if (order.paymentStatus !== ORDER_PAYMENT_STATUS.PENDING) {
    throw AppError.badRequest(`Payment cannot be created while paymentStatus is ${order.paymentStatus}.`);
  }
  if (order.status !== ORDER_STATUS.PAYMENT_PENDING) {
    throw AppError.badRequest(`Order is not currently awaiting payment (status: ${order.status}).`);
  }

  const existing = await getLatestPayment(order._id);
  if (existing && existing.status === PAYMENT_ATTEMPT_STATUS.CREATED) {
    // Reuse the still-open attempt instead of minting another provider order.
    return {
      razorpayOrderId: existing.providerOrderId,
      amount: existing.amountPaise,
      currency: existing.currency,
      keyId: env.RAZORPAY_KEY_ID || null,
    };
  }

  // Authoritative amount: the order's own immutable pricing snapshot, never
  // anything client-submitted, never the live Service, never recomputed.
  const amountPaise = order.pricing.totalAmountMinor;
  const currency = order.pricing.currency;
  const attemptNumber = (existing?.attemptNumber || 0) + 1;

  const provider = getPaymentProvider();
  const providerName = provider.constructor.name === 'RazorpayProvider' ? 'RAZORPAY' : 'DEVELOPMENT';

  const idempotencyKey = `${order._id}:${attemptNumber}`;
  const paymentCode = await generatePaymentCode();
  let payment;
  try {
    payment = await Payment.create({
      order: order._id,
      client: order.client,
      paymentCode,
      provider: providerName,
      amountPaise,
      currency,
      status: PAYMENT_ATTEMPT_STATUS.CREATED,
      attemptNumber,
      idempotencyKey,
    });
  } catch (err) {
    if (err.code === 11000) {
      // A concurrent request already created this exact attempt - fetch and
      // return it rather than erroring, which is what idempotency means here.
      const created = await Payment.findOne({ idempotencyKey });
      if (created) {
        return { razorpayOrderId: created.providerOrderId, amount: created.amountPaise, currency: created.currency, keyId: env.RAZORPAY_KEY_ID || null };
      }
    }
    throw err;
  }

  const providerOrder = await provider.createOrder({ amount: amountPaise, currency, receipt: order.orderCode });
  payment.providerOrderId = providerOrder.providerOrderId;
  await payment.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.PAYMENT_ORDER_CREATED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { paymentId: String(payment._id), providerOrderId: payment.providerOrderId, amountPaise, currency, attemptNumber },
    ...meta,
  });

  return { razorpayOrderId: payment.providerOrderId, amount: amountPaise, currency, keyId: env.RAZORPAY_KEY_ID || null };
}

/**
 * Verifies a checkout-returned signature and, if valid, confirms the
 * payment and transitions the order through the EXISTING state machine
 * (which itself syncs paymentStatus -> PAID on reaching PAYMENT_CONFIRMED -
 * see orderStateMachine.service.js). Never trusts razorpay_signature's
 * validity claim from the browser - always recomputed server-side.
 */
async function verifyPayment({ order, providerOrderId, providerPaymentId, signature, actor, meta = {} }) {
  if (!providerOrderId || !providerPaymentId || !signature) {
    throw AppError.badRequest('Payment identifiers and signature are required.');
  }

  // Resolved by providerOrderId SCOPED TO THIS ORDER - a client can never
  // point this endpoint at a payment attempt belonging to a different order.
  const payment = await Payment.findOne({ order: order._id, providerOrderId });
  if (!payment) {
    throw AppError.notFound('No matching payment attempt found for this order.');
  }

  if (payment.status === PAYMENT_ATTEMPT_STATUS.CONFIRMED) {
    // Already processed (e.g. the client retried after a flaky network
    // response) - idempotent success, never re-run side effects.
    return { payment, order };
  }

  const provider = getPaymentProvider();
  const isValid = await provider.verifyPayment({ providerOrderId, providerPaymentId, signature });

  if (!isValid) {
    payment.status = PAYMENT_ATTEMPT_STATUS.FAILED;
    payment.failedAt = new Date();
    payment.failureReason = 'Signature verification failed.';
    await payment.save();

    await logAudit({
      ...auditCtx(actor),
      action: AUDIT_ACTIONS.PAYMENT_FAILED,
      resourceType: 'Order',
      resourceId: order._id,
      metadata: { paymentId: String(payment._id), reason: 'INVALID_SIGNATURE' },
      ...meta,
    });
    await communicationService.sendOrderPaymentFailed(order).catch(() => {});
    await notificationEventsService.notifyOrderPaymentFailed(order).catch(() => {});
    throw AppError.badRequest('Payment verification failed.');
  }

  payment.providerPaymentId = providerPaymentId;
  payment.providerSignature = signature;
  payment.signatureVerified = true;
  payment.captured = true;
  payment.status = PAYMENT_ATTEMPT_STATUS.CONFIRMED;
  payment.paidAt = new Date();
  // Clear any earlier failed-verification bookkeeping on this same attempt
  // (e.g. a first signature check that failed before a correct retry) -
  // a confirmed payment must never display a stale failure reason.
  payment.failedAt = null;
  payment.failureReason = null;
  await payment.save();

  let updatedOrder = order;
  if (order.status === ORDER_STATUS.PAYMENT_PENDING) {
    updatedOrder = await transitionOrderStatus({
      orderId: order._id,
      toStatus: ORDER_STATUS.PAYMENT_CONFIRMED,
      changedBy: actor?._id || null,
      reason: 'Payment verified.',
    });
  }

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.PAYMENT_VERIFIED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { paymentId: String(payment._id), providerPaymentId },
    ...meta,
  });

  return { payment, order: updatedOrder };
}

/**
 * Client-reported checkout failure (e.g. Razorpay Checkout's own
 * "payment.failed" handler fired in the browser). This is NOT a trusted
 * signal of anything beyond "this one attempt didn't complete" - it only
 * ever flips the CURRENT CREATED attempt to FAILED for bookkeeping/history.
 * It never fails the order itself (order stays PAYMENT_PENDING, eligible
 * for another attempt) and never touches any other attempt or any other
 * order.
 */
async function recordClientReportedFailure({ order, providerOrderId, reason, actor, meta = {} }) {
  const payment = await Payment.findOne({ order: order._id, providerOrderId, status: PAYMENT_ATTEMPT_STATUS.CREATED });
  if (!payment) {
    // Nothing to do - either already resolved or not this order's attempt.
    return null;
  }
  payment.status = PAYMENT_ATTEMPT_STATUS.FAILED;
  payment.failedAt = new Date();
  payment.failureReason = String(reason || 'Checkout did not complete.').slice(0, 300);
  await payment.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.PAYMENT_FAILED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { paymentId: String(payment._id), reason: 'CLIENT_REPORTED', clientReason: payment.failureReason },
    ...meta,
  });
  await communicationService.sendOrderPaymentFailed(order).catch(() => {});
  await notificationEventsService.notifyOrderPaymentFailed(order).catch(() => {});

  return payment;
}

/**
 * Processes one inbound Razorpay webhook delivery. Signature is verified
 * against the RAW body by the caller (routes/webhooks.routes.js) before
 * this is ever invoked. Deduplicated via PaymentWebhookEvent's unique
 * eventId - a replayed delivery is detected via the unique-index conflict
 * and treated as an already-processed no-op, never re-applying side effects.
 */
async function processWebhookEvent(parsedBody) {
  const eventId = parsedBody?.id;
  const eventType = parsedBody?.event;
  if (!eventId || !eventType) {
    throw AppError.badRequest('Malformed webhook payload.');
  }

  let ledgerEntry;
  try {
    ledgerEntry = await PaymentWebhookEvent.create({ eventId, eventType });
  } catch (err) {
    if (err.code === 11000) {
      logger.info(`[payment.webhook] Duplicate delivery ignored: ${eventId}`);
      return { duplicate: true };
    }
    throw err;
  }

  const paymentEntity =
    parsedBody?.payload?.payment?.entity || parsedBody?.payload?.order?.entity?.payments?.[0] || null;
  const providerPaymentId = paymentEntity?.id || null;
  const providerOrderId = paymentEntity?.order_id || parsedBody?.payload?.order?.entity?.id || null;

  let outcome = 'No matching local payment.';
  let matchedPayment = null;

  if (providerOrderId) {
    // Resolved by providerOrderId - never trust the webhook to name an
    // arbitrary local order/payment id directly.
    matchedPayment = await Payment.findOne({ providerOrderId });
  }

  if (matchedPayment) {
    if (['payment.captured', 'order.paid'].includes(eventType)) {
      if (matchedPayment.status !== PAYMENT_ATTEMPT_STATUS.CONFIRMED) {
        matchedPayment.providerPaymentId = providerPaymentId || matchedPayment.providerPaymentId;
        matchedPayment.method = paymentEntity?.method || matchedPayment.method;
        matchedPayment.captured = true;
        matchedPayment.status = PAYMENT_ATTEMPT_STATUS.CONFIRMED;
        matchedPayment.paidAt = matchedPayment.paidAt || new Date();
        matchedPayment.providerPayloadReference = eventId;
        await matchedPayment.save();

        const order = await require('../../models/portal').Order.findById(matchedPayment.order);
        if (order && order.status === ORDER_STATUS.PAYMENT_PENDING) {
          await transitionOrderStatus({
            orderId: order._id,
            toStatus: ORDER_STATUS.PAYMENT_CONFIRMED,
            changedBy: null,
            reason: `Confirmed via Razorpay webhook (${eventType}).`,
          });
        }
        outcome = `Payment confirmed via webhook (${eventType}).`;
      } else {
        outcome = 'Already confirmed - no-op.';
      }
    } else if (eventType === 'payment.failed') {
      if (matchedPayment.status === PAYMENT_ATTEMPT_STATUS.CREATED) {
        matchedPayment.status = PAYMENT_ATTEMPT_STATUS.FAILED;
        matchedPayment.failedAt = new Date();
        matchedPayment.failureReason = String(paymentEntity?.error_description || 'Payment failed at provider.').slice(0, 300);
        matchedPayment.providerPayloadReference = eventId;
        await matchedPayment.save();
        const failedOrder = await require('../../models/portal').Order.findById(matchedPayment.order);
        if (failedOrder) {
          await communicationService.sendOrderPaymentFailed(failedOrder).catch(() => {});
          await notificationEventsService.notifyOrderPaymentFailed(failedOrder).catch(() => {});
        }
        outcome = 'Payment marked FAILED via webhook.';
      } else {
        outcome = 'Attempt already resolved - no-op.';
      }
    } else {
      outcome = `Unhandled event type: ${eventType}.`;
    }
  }

  ledgerEntry.payment = matchedPayment?._id || null;
  ledgerEntry.order = matchedPayment?.order || null;
  ledgerEntry.outcome = outcome;
  await ledgerEntry.save();

  await logAudit({
    actor: null,
    actorRole: 'SYSTEM',
    action: AUDIT_ACTIONS.PAYMENT_WEBHOOK_RECEIVED,
    resourceType: 'Order',
    resourceId: matchedPayment?.order || null,
    metadata: { eventId, eventType, outcome },
  });

  return { duplicate: false, outcome };
}

/**
 * Compares local payment state against the provider's own record of it.
 * Used when a webhook is delayed/missing or a verify request failed after
 * the browser-side checkout actually succeeded. Never trusts the frontend's
 * claim of success - always re-fetches from the provider.
 */
async function reconcilePayment(payment, { actor, meta = {} } = {}) {
  if (!payment.providerPaymentId) {
    return { changed: false, reason: 'No provider payment id to reconcile against yet.' };
  }
  const provider = getPaymentProvider();
  const providerPayment = await provider.fetchPayment(payment.providerPaymentId);
  const providerStatus = providerPayment.status;

  let changed = false;
  if (providerStatus === 'captured' && payment.status !== PAYMENT_ATTEMPT_STATUS.CONFIRMED) {
    payment.status = PAYMENT_ATTEMPT_STATUS.CONFIRMED;
    payment.captured = true;
    payment.paidAt = payment.paidAt || new Date();
    changed = true;
  } else if (providerStatus === 'failed' && payment.status === PAYMENT_ATTEMPT_STATUS.CREATED) {
    payment.status = PAYMENT_ATTEMPT_STATUS.FAILED;
    payment.failedAt = new Date();
    payment.failureReason = 'Reconciliation found a failed provider payment.';
    changed = true;
  }

  if (changed) {
    await payment.save();
    if (payment.status === PAYMENT_ATTEMPT_STATUS.CONFIRMED) {
      const order = await require('../../models/portal').Order.findById(payment.order);
      if (order && order.status === ORDER_STATUS.PAYMENT_PENDING) {
        await transitionOrderStatus({ orderId: order._id, toStatus: ORDER_STATUS.PAYMENT_CONFIRMED, changedBy: actor?._id || null, reason: 'Reconciled with provider.' });
      }
    }
    await logAudit({
      ...auditCtx(actor),
      action: AUDIT_ACTIONS.PAYMENT_RECONCILED,
      resourceType: 'Order',
      resourceId: payment.order,
      metadata: { paymentId: String(payment._id), providerStatus, newLocalStatus: payment.status },
      ...meta,
    });
  }

  return { changed, providerStatus };
}

/**
 * Full-refund-only for this phase (one successful payment per order is
 * assumed). Amount is always server-derived/validated, never trusted from
 * the client beyond an optional reason string.
 */
async function requestRefund({ payment, order, actor, reason, meta = {} }) {
  // Checked first and specifically: this phase is full-refund-only, so a
  // payment's status moves CONFIRMED -> REFUNDED in one step and never sits
  // at CONFIRMED with a partial refundAmountPaise - the "already refunded"
  // case is always this status, never a CONFIRMED-with-nothing-left-to-refund
  // state, so give it its own accurate message instead of a generic one.
  if (payment.status === PAYMENT_ATTEMPT_STATUS.REFUNDED) {
    throw AppError.conflict('This payment has already been fully refunded.');
  }
  if (payment.status !== PAYMENT_ATTEMPT_STATUS.CONFIRMED) {
    throw AppError.badRequest('Only a confirmed payment can be refunded.');
  }
  const refundable = payment.amountPaise - payment.refundAmountPaise;
  if (!isValidPaymentStatusTransition(order.paymentStatus, ORDER_PAYMENT_STATUS.REFUNDED)) {
    throw AppError.invalidStateTransition(`Cannot move payment status from ${order.paymentStatus} to ${ORDER_PAYMENT_STATUS.REFUNDED}.`);
  }

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.PAYMENT_REFUND_REQUESTED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { paymentId: String(payment._id), amountPaise: refundable, reason: reason || null },
    ...meta,
  });

  const provider = getPaymentProvider();
  const refund = await provider.refundPayment({ providerPaymentId: payment.providerPaymentId, amount: refundable, notes: reason ? { reason } : undefined });

  payment.refundAmountPaise += refundable;
  payment.status = PAYMENT_ATTEMPT_STATUS.REFUNDED;
  payment.refundedAt = new Date();
  await payment.save();

  const previousPaymentStatus = order.paymentStatus;
  order.paymentStatus = ORDER_PAYMENT_STATUS.REFUNDED;
  order.updatedBy = actor._id;
  await order.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.PAYMENT_REFUNDED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { paymentId: String(payment._id), refundId: refund.refundId, amountPaise: refundable, from: previousPaymentStatus },
    ...meta,
  });

  await communicationService.sendPaymentRefunded(order, { amountPaise: refundable }).catch(() => {});
  await notificationEventsService.notifyPaymentRefunded(order).catch(() => {});

  return { payment, order };
}

module.exports = {
  serializePaymentForInternal,
  serializePaymentForClient,
  getLatestPayment,
  createPaymentOrder,
  verifyPayment,
  recordClientReportedFailure,
  processWebhookEvent,
  reconcilePayment,
  requestRefund,
};
