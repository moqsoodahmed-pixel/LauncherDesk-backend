const Razorpay = require('razorpay')
const crypto   = require('crypto')
const Payment  = require('../models/Payment')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

const isPaymentConfigured = () =>
  !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)

const getRazorpay = () => {
  if (!isPaymentConfigured()) {
    throw new AppError('Payment processing is not yet configured. Please request a quote instead.', 503)
  }
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  })
}

// GET /api/payments/config — public, lets frontend decide whether to show Buy Now
exports.getConfig = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    enabled: isPaymentConfigured(),
    keyId:   isPaymentConfigured() ? process.env.RAZORPAY_KEY_ID : null,
  })
})

// POST /api/payments/create-order — protected
exports.createOrder = asyncHandler(async (req, res, next) => {
  const { amount, currency = 'INR', serviceSlug, serviceTitle } = req.body
  if (!amount || isNaN(Number(amount))) return next(new AppError('A valid amount is required', 400))
  const amountNum = Math.round(Number(amount))
  if (amountNum <= 0 || amountNum > 1000000) return next(new AppError('Amount must be between ₹1 and ₹10,00,000', 400))
  if (!serviceSlug) return next(new AppError('serviceSlug is required', 400))

  const razorpay = getRazorpay()
  const order = await razorpay.orders.create({
    amount:  amountNum * 100,
    currency,
    receipt: `ld_${Date.now()}`,
    notes: {
      userId:       req.user._id.toString(),
      userName:     req.user.name,
      userEmail:    req.user.email,
      serviceSlug:  serviceSlug || '',
      serviceTitle: serviceTitle || '',
    },
  })

  const payment = await Payment.create({
    user:            req.user._id,
    razorpayOrderId: order.id,
    serviceSlug:     serviceSlug || '',
    serviceTitle:    serviceTitle || '',
    amountPaise:     order.amount,
    amountRupees:    amountNum,
    currency,
    status:          'created',
  })

  // LauncherDesk order (LD-YYYY-NNNNNN) linked to this checkout
  const ldOrder = await require('../services/orderService').createOrder({
    userId: req.user._id, serviceSlug, serviceTitle, amount: amountNum, paymentId: payment._id,
  })
  await Payment.updateOne({ _id: payment._id }, { order: ldOrder._id })

  console.log(`[Payment] Order created: ${order.id} — ${ldOrder.orderNumber} — ₹${amountNum} — ${req.user.email} — ${serviceSlug}`)

  res.json({
    success:     true,
    orderId:     order.id,
    paymentDbId: payment._id.toString(),
    ldOrderId:   ldOrder._id.toString(),
    orderNumber: ldOrder.orderNumber,
    amount:      order.amount,
    currency:    order.currency,
    keyId:       process.env.RAZORPAY_KEY_ID,
  })
})

// POST /api/payments/verify — protected
exports.verifyPayment = asyncHandler(async (req, res, next) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, serviceSlug, serviceTitle } = req.body
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return next(new AppError('Payment verification data missing', 400))
  }

  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id })
  if (!payment) return next(new AppError('Payment record not found', 404))
  if (payment.user.toString() !== req.user._id.toString()) return next(new AppError('Not authorised', 403))

  const body     = `${razorpay_order_id}|${razorpay_payment_id}`
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex')
  const sigOk = expected.length === String(razorpay_signature).length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(razorpay_signature)))
  if (!sigOk) {
    // Don't mark the payment failed here — a tampered browser request must not override
    // the real state. The Razorpay webhook remains the source of truth.
    console.warn(`[Payment] Signature mismatch on verify: ${razorpay_order_id} by ${req.user.email}`)
    return next(new AppError('Payment verification failed — please contact support', 400))
  }

  // Shared, idempotent success path (also used by the Razorpay webhook).
  const { order, alreadyProcessed } = await require('../services/paymentService').markPaid({
    razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id, source: 'customer',
  })
  console.log(`[Payment] Verified${alreadyProcessed ? ' (already processed)' : ''}: ${razorpay_payment_id} — ${req.user.email}`)
  res.json({
    success: true, paymentId: razorpay_payment_id, orderNumber: order?.orderNumber, ldOrderId: order?._id,
    message: alreadyProcessed ? 'Payment already confirmed.' : 'Payment verified successfully. Our team will be in touch shortly!',
  })
})

/**
 * POST /api/payments/webhook — Razorpay webhooks (server-to-server, source of truth).
 * Mounted with express.raw() in server.js so the signature is checked against the exact body.
 * Configure in Razorpay Dashboard → Settings → Webhooks with secret RAZORPAY_WEBHOOK_SECRET and events:
 *   payment.captured, payment.failed, order.paid, refund.created, refund.processed, refund.failed
 */
exports.webhook = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  const signature = req.headers['x-razorpay-signature']
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}))
  if (!secret || !signature) return res.status(400).json({ success: false, message: 'Webhook not configured' })

  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    console.warn('[Webhook] Invalid Razorpay signature')
    return res.status(400).json({ success: false, message: 'Invalid signature' })
  }

  let body
  try { body = JSON.parse(raw.toString('utf8')) } catch { return res.status(400).json({ success: false }) }
  const eventId = req.headers['x-razorpay-event-id'] || `${body.event}:${body.payload?.payment?.entity?.id || body.payload?.refund?.entity?.id || ''}:${body.created_at}`

  // Duplicate delivery protection
  const WebhookEvent = require('../models/WebhookEvent')
  try { await WebhookEvent.create({ eventId, event: body.event, payload: body.payload }) }
  catch (e) { if (e.code === 11000) return res.json({ success: true, duplicate: true }); throw e }

  const svc = require('../services/paymentService')
  try {
    const pay = body.payload?.payment?.entity
    const ref = body.payload?.refund?.entity
    switch (body.event) {
      case 'payment.captured':
      case 'order.paid':
        if (pay?.order_id) await svc.markPaid({ razorpayOrderId: pay.order_id, razorpayPaymentId: pay.id, method: pay.method, source: 'razorpay' })
        break
      case 'payment.failed':
        if (pay?.order_id) await svc.markFailed({ razorpayOrderId: pay.order_id, razorpayPaymentId: pay.id, reason: pay.error_description || pay.error_reason || 'Payment failed', source: 'razorpay' })
        break
      case 'refund.created':
      case 'refund.processed':
      case 'refund.failed':
        if (ref?.payment_id) await svc.recordRefund({
          razorpayPaymentId: ref.payment_id, refundId: ref.id, amountPaise: ref.amount,
          status: body.event === 'refund.processed' ? 'processed' : body.event === 'refund.failed' ? 'failed' : 'pending',
        })
        break
      default:
        break
    }
    res.json({ success: true })
  } catch (err) {
    // Let Razorpay retry: remove the idempotency record so the retry is processed.
    await WebhookEvent.deleteOne({ eventId }).catch(() => {})
    console.error('[Webhook] Processing error:', err.message)
    res.status(500).json({ success: false })
  }
}

/**
 * Admin: start a refund through Razorpay. Customer emails are sent from the
 * refund webhooks (actual Razorpay status), not from this request.
 * Body: { amount (rupees, optional = full), reason }
 */
exports.adminRefund = asyncHandler(async (req, res, next) => {
  const ServiceOrder = require('../models/ServiceOrder')
  const order = await ServiceOrder.findById(req.params.id)
  if (!order?.payment) return next(new AppError('Order has no payment', 400))
  const payment = await Payment.findById(order.payment)
  if (!payment?.razorpayPaymentId || !['paid', 'partially_refunded'].includes(payment.status)) return next(new AppError('Payment is not refundable', 400))
  const remaining = payment.amountPaise - (payment.refundedPaise || 0)
  const amountPaise = req.body.amount ? Math.round(Number(req.body.amount) * 100) : remaining
  if (!(amountPaise > 0 && amountPaise <= remaining)) return next(new AppError('Invalid refund amount', 400))

  const refund = await getRazorpay().payments.refund(payment.razorpayPaymentId, { amount: amountPaise, notes: { reason: req.body.reason || '', orderNumber: order.orderNumber } })
  await require('../services/paymentService').recordRefund({
    razorpayPaymentId: payment.razorpayPaymentId, refundId: refund.id, amountPaise: refund.amount,
    status: refund.status === 'processed' ? 'processed' : 'pending', source: req.user.email,
  })
  res.json({ success: true, refundId: refund.id, status: refund.status })
})
