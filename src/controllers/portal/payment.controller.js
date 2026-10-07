const paymentService = require('../../services/portal/payment.service');
const AppError = require('../../utils/portal/AppError');
const { sendSuccess } = require('../../utils/portal/apiResponse');

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

async function createOrder(req, res, next) {
  try {
    const result = await paymentService.createPaymentOrder({ order: req.resource, actor: req.user, meta: requestMeta(req) });
    return sendSuccess(res, { statusCode: 201, message: 'Payment order created.', data: result });
  } catch (err) {
    next(err);
  }
}

async function verify(req, res, next) {
  try {
    const { razorpay_order_id: providerOrderId, razorpay_payment_id: providerPaymentId, razorpay_signature: signature } = req.body;
    const { payment, order } = await paymentService.verifyPayment({
      order: req.resource,
      providerOrderId,
      providerPaymentId,
      signature,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, {
      message: 'Payment verified.',
      data: { paymentStatus: order.paymentStatus, orderStatus: order.status, payment: paymentService.serializePaymentForClient(payment) },
    });
  } catch (err) {
    next(err);
  }
}

async function reportFailure(req, res, next) {
  try {
    await paymentService.recordClientReportedFailure({
      order: req.resource,
      providerOrderId: req.body.razorpay_order_id,
      reason: req.body.reason,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, { message: 'Noted.', data: null });
  } catch (err) {
    next(err);
  }
}

async function getOwnPaymentStatus(req, res, next) {
  try {
    const payment = await paymentService.getLatestPayment(req.resource._id);
    return sendSuccess(res, {
      message: 'Payment status.',
      data: { paymentStatus: req.resource.paymentStatus, payment: paymentService.serializePaymentForClient(payment) },
    });
  } catch (err) {
    next(err);
  }
}

async function getForOrder(req, res, next) {
  try {
    const payment = await paymentService.getLatestPayment(req.resource._id);
    return sendSuccess(res, {
      message: 'Payment.',
      data: { paymentStatus: req.resource.paymentStatus, payment: payment ? paymentService.serializePaymentForInternal(payment) : null },
    });
  } catch (err) {
    next(err);
  }
}

async function refund(req, res, next) {
  try {
    const payment = await paymentService.getLatestPayment(req.resource._id);
    if (!payment) {
      throw AppError.notFound('No payment found for this order.');
    }
    const { payment: updatedPayment, order } = await paymentService.requestRefund({
      payment,
      order: req.resource,
      actor: req.user,
      reason: req.body.reason,
      meta: requestMeta(req),
    });
    return sendSuccess(res, {
      message: 'Payment refunded.',
      data: { paymentStatus: order.paymentStatus, payment: paymentService.serializePaymentForInternal(updatedPayment) },
    });
  } catch (err) {
    next(err);
  }
}

async function reconcile(req, res, next) {
  try {
    const payment = await paymentService.getLatestPayment(req.resource._id);
    if (!payment) {
      throw AppError.notFound('No payment found for this order.');
    }
    const result = await paymentService.reconcilePayment(payment, { actor: req.user, meta: requestMeta(req) });
    return sendSuccess(res, { message: 'Reconciliation complete.', data: result });
  } catch (err) {
    next(err);
  }
}

// Webhook handler is intentionally separate from the above - no req.user,
// no req.resource (loadOrder never runs for this route). Signature is
// verified against the raw body by routes/webhooks.routes.js before this
// is ever called.
async function webhook(req, res) {
  try {
    const parsedBody = JSON.parse(req.rawBody.toString('utf8'));
    const result = await paymentService.processWebhookEvent(parsedBody);
    return res.status(200).json({ success: true, message: 'Webhook processed.', data: result });
  } catch (err) {
    // Never throw a 5xx for a malformed/unexpected webhook body - Razorpay
    // will retry indefinitely; a 400 tells it this delivery is permanently
    // unprocessable, never reflecting internal error details back out.
    return res.status(400).json({ success: false, message: 'Webhook could not be processed.', code: 'VALIDATION_ERROR' });
  }
}

module.exports = { createOrder, verify, reportFailure, getOwnPaymentStatus, getForOrder, refund, reconcile, webhook };
