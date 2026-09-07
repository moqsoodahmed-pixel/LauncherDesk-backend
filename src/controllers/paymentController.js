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

  console.log(`[Payment] Order created: ${order.id} — ₹${amountNum} — ${req.user.email} — ${serviceSlug}`)

  res.json({
    success:     true,
    orderId:     order.id,
    paymentDbId: payment._id.toString(),
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

  if (payment.processedAt) {
    console.warn(`[Payment] Duplicate verify: ${razorpay_order_id} by ${req.user.email}`)
    return res.json({ success: true, paymentId: payment.razorpayPaymentId, message: 'Payment already confirmed.' })
  }

  const body     = `${razorpay_order_id}|${razorpay_payment_id}`
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex')

  if (expected !== razorpay_signature) {
    await Payment.findByIdAndUpdate(payment._id, { status: 'failed', failureReason: 'Signature mismatch', processedAt: new Date() })
    return next(new AppError('Payment verification failed — please contact support', 400))
  }

  await Payment.findByIdAndUpdate(payment._id, {
    razorpayPaymentId: razorpay_payment_id,
    status:     'paid',
    verifiedAt: new Date(),
    processedAt: new Date(),
  })

  console.log(`[Payment] Verified: ${razorpay_payment_id} — ${req.user.email} — ₹${payment.amountRupees}`)

  const { sendEmail } = require('../config/email')
  const amtDisplay    = `₹${payment.amountRupees.toLocaleString('en-IN')}`
  const svcLabel      = serviceTitle || serviceSlug || 'Service'

  Promise.all([
    sendEmail({
      to: process.env.SUPPORT_EMAIL || 'contact@launcherdesk.com',
      fromName: 'LauncherDesk Payments', fromEmail: process.env.EMAIL_FROM_ADDR,
      subject: `Payment Received: ${svcLabel} — ${amtDisplay}`,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto"><h2 style="color:#0a2540">Payment Received ✅</h2><table style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:8px 0;font-weight:600;width:160px">Service</td><td>${svcLabel}</td></tr><tr><td style="padding:8px 0;font-weight:600">Amount</td><td>${amtDisplay}</td></tr><tr><td style="padding:8px 0;font-weight:600">Customer</td><td>${req.user.name} (${req.user.email})</td></tr><tr><td style="padding:8px 0;font-weight:600">Payment ID</td><td>${razorpay_payment_id}</td></tr><tr><td style="padding:8px 0;font-weight:600">Order ID</td><td>${razorpay_order_id}</td></tr></table></div>`,
    }),
    sendEmail({
      to: req.user.email,
      fromName: 'LauncherDesk', fromEmail: process.env.EMAIL_FROM_ADDR,
      subject: `Payment confirmed — ${svcLabel}`,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a2b3c"><div style="background:linear-gradient(135deg,#1A2F4E,#1D6FE0);padding:28px;border-radius:12px 12px 0 0;text-align:center"><h1 style="color:#fff;font-size:20px;margin:0">Payment Confirmed ✅</h1></div><div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px"><p>Hi <strong>${req.user.name}</strong>,</p><p>We have received your payment of <strong>${amtDisplay}</strong> for <strong>${svcLabel}</strong>.</p><p>Our team will begin processing your service within <strong>1 business day</strong>.</p><p style="font-size:13px;color:#64748B">Payment ID: ${razorpay_payment_id}</p><hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/><p style="font-size:12px;color:#94A3B8;text-align:center">LauncherDesk | <a href="https://launcherdesk.com">launcherdesk.com</a></p></div></div>`,
    }),
  ]).catch(err => console.error('[Payment email error]', err.message))

  res.json({ success: true, paymentId: razorpay_payment_id, message: 'Payment verified successfully. Our team will be in touch shortly!' })
})