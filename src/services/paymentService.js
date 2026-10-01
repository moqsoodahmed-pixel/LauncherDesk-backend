/**
 * The single, safe path for payment state changes. Both the browser
 * "verify" call and the Razorpay webhook call these functions; an atomic
 * update guarantees the success flow (order update, emails, invoice,
 * document request) runs exactly once per payment.
 */
const Payment = require('../models/Payment')
const ServiceOrder = require('../models/ServiceOrder')
const events = require('./events')
const orderService = require('./orderService')
const { createInvoice } = require('./invoiceService')

async function ensureOrder(payment) {
  if (payment.order) {
    const o = await ServiceOrder.findById(payment.order)
    if (o) return o
  }
  const o = await orderService.createOrder({
    userId: payment.user, serviceSlug: payment.serviceSlug || 'service', serviceTitle: payment.serviceTitle,
    amount: payment.amountRupees, paymentId: payment._id, triggeredBy: 'system',
  })
  await Payment.updateOne({ _id: payment._id }, { order: o._id })
  return o
}

/** @returns {{ payment, order, alreadyProcessed }} */
async function markPaid({ razorpayOrderId, razorpayPaymentId, method, source = 'system' }) {
  const payment = await Payment.findOneAndUpdate(
    { razorpayOrderId, status: { $nin: ['paid', 'refunded', 'partially_refunded'] } },
    { status: 'paid', razorpayPaymentId, method, verifiedAt: new Date(), processedAt: new Date(), failureReason: undefined },
    { new: true }
  )
  if (!payment) {
    const p = await Payment.findOne({ razorpayOrderId })
    return { payment: p, order: p?.order ? await ServiceOrder.findById(p.order) : null, alreadyProcessed: true }
  }

  const order = await ensureOrder(payment)
  await orderService.changeStatus(order._id, 'PAYMENT_SUCCESSFUL', { by: source, notifyCustomer: false, set: { paymentStatus: 'PAYMENT_SUCCESSFUL', payment: payment._id } })
  // Key = order + event + template + payment_id → a duplicate webhook can never resend it.
  await events.emit('PAYMENT_SUCCESSFUL', { orderId: order._id, paymentId: payment._id, triggeredBy: source, dedupe: razorpayPaymentId, metadata: { razorpayPaymentId, amount: payment.amountRupees } })

  const { invoice } = await createInvoice(order, payment)
  await events.emit('INVOICE_GENERATED', { orderId: order._id, invoiceId: invoice._id, paymentId: payment._id, triggeredBy: 'system', dedupe: invoice.invoiceNumber })

  await orderService.requestDocuments(order._id, { by: 'system' })
  const fresh = await ServiceOrder.findById(order._id)
  if (fresh.documentStatus === 'NOT_REQUIRED') await orderService.changeStatus(order._id, 'PROCESSING', { by: 'system' })

  notifyTeam(payment, order).catch(() => {})
  return { payment, order: await ServiceOrder.findById(order._id), alreadyProcessed: false }
}

async function markFailed({ razorpayOrderId, razorpayPaymentId, reason, source = 'system' }) {
  const payment = await Payment.findOneAndUpdate(
    { razorpayOrderId, status: 'created' },
    { status: 'failed', razorpayPaymentId, failureReason: reason, processedAt: new Date() },
    { new: true }
  )
  if (!payment) return { alreadyProcessed: true }
  const order = await ensureOrder(payment)
  await orderService.changeStatus(order._id, 'PAYMENT_FAILED', { by: source, notifyCustomer: false, set: { paymentStatus: 'PAYMENT_FAILED' } })
  await events.emit('PAYMENT_FAILED', { orderId: order._id, paymentId: payment._id, triggeredBy: source, dedupe: razorpayPaymentId || 'nopay', metadata: { reason } })
  return { payment, order }
}

/** Refund state from Razorpay (refund.created / refund.processed / refund.failed). */
async function recordRefund({ razorpayPaymentId, refundId, amountPaise, status, source = 'razorpay' }) {
  const payment = await Payment.findOne({ razorpayPaymentId })
  if (!payment) return { ignored: true }
  const existing = payment.refunds.find(r => r.refundId === refundId)
  if (existing) { existing.status = status; if (status === 'processed') existing.processedAt = new Date() }
  else payment.refunds.push({ refundId, amountPaise, status, createdAt: new Date(), processedAt: status === 'processed' ? new Date() : undefined })

  const processedPaise = payment.refunds.filter(r => r.status === 'processed').reduce((a, r) => a + (r.amountPaise || 0), 0)
  payment.refundedPaise = processedPaise
  if (processedPaise > 0) payment.status = processedPaise >= payment.amountPaise ? 'refunded' : 'partially_refunded'
  await payment.save()

  const order = payment.order ? await ServiceOrder.findById(payment.order) : null
  if (!order) return { payment }
  const extra = { refund_id: refundId, refund_amount: `₹${((amountPaise || 0) / 100).toLocaleString('en-IN')}` }

  if (status === 'failed') {
    await events.emit('REFUND_FAILED', { orderId: order._id, triggeredBy: source, metadata: { refundId }, notifyCustomer: false })
  } else if (status === 'processed') {
    const full = processedPaise >= payment.amountPaise
    await orderService.changeStatus(order._id, full ? 'REFUNDED' : order.status, { by: source, notifyCustomer: false, set: { paymentStatus: full ? 'PAYMENT_REFUNDED' : 'PAYMENT_PARTIALLY_REFUNDED' } })
    await events.emit('REFUND_COMPLETED', { orderId: order._id, triggeredBy: source, dedupe: refundId, extra })
  } else {
    await orderService.changeStatus(order._id, 'REFUND_INITIATED', { by: source, notifyCustomer: false })
    await events.emit('REFUND_INITIATED', { orderId: order._id, triggeredBy: source, dedupe: refundId, extra })
  }
  return { payment, order }
}

/** Internal alert to the LauncherDesk team (not a customer email). */
async function notifyTeam(payment, order) {
  const to = process.env.SUPPORT_EMAIL
  if (!to) return
  const { getProvider } = require('./notification/providers')
  const amt = `₹${payment.amountRupees.toLocaleString('en-IN')}`
  await getProvider().send({
    to, subject: `Payment received: ${order.serviceTitle} — ${amt} (${order.orderNumber})`,
    html: `<p>New paid order <strong>${order.orderNumber}</strong></p><p>Service: ${order.serviceTitle}<br>Amount: ${amt}<br>Razorpay payment: ${payment.razorpayPaymentId}</p>`,
    text: `New paid order ${order.orderNumber}\nService: ${order.serviceTitle}\nAmount: ${amt}\nRazorpay payment: ${payment.razorpayPaymentId}`,
  })
}

module.exports = { markPaid, markFailed, recordRefund }
