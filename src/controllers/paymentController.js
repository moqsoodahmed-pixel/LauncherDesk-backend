const Razorpay  = require('razorpay')
const crypto    = require('crypto')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new AppError('Razorpay is not configured on the server', 500)
  }
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  })
}

// POST /api/payments/create-order
// Creates a Razorpay order and returns order_id to frontend
exports.createOrder = asyncHandler(async (req, res, next) => {
  const { amount, currency = 'INR', serviceSlug, serviceTitle } = req.body
  if (!amount) return next(new AppError('Amount is required', 400))

  const razorpay = getRazorpay()

  const order = await razorpay.orders.create({
    amount:   Math.round(Number(amount) * 100), // paise
    currency,
    receipt:  `ld_${Date.now()}`,
    notes: {
      userId:       req.user._id.toString(),
      userName:     req.user.name,
      userEmail:    req.user.email,
      serviceSlug:  serviceSlug || '',
      serviceTitle: serviceTitle || '',
    },
  })

  console.log(`[Payment] Order created: ${order.id} for ₹${amount} — ${req.user.email}`)

  res.json({
    success:  true,
    orderId:  order.id,
    amount:   order.amount,
    currency: order.currency,
    keyId:    process.env.RAZORPAY_KEY_ID,
  })
})

// POST /api/payments/verify
// Verifies payment signature after Razorpay popup completes
exports.verifyPayment = asyncHandler(async (req, res, next) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, serviceSlug, serviceTitle, amount } = req.body

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return next(new AppError('Payment verification data missing', 400))
  }

  // Verify signature
  const body      = `${razorpay_order_id}|${razorpay_payment_id}`
  const expected  = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex')

  if (expected !== razorpay_signature) {
    return next(new AppError('Payment verification failed — invalid signature', 400))
  }

  console.log(`[Payment] Verified: ${razorpay_payment_id} for ${req.user.email}`)

  // Send confirmation email (fire-and-forget)
  const { sendEmail } = require('../config/email')
  const amountInRupees = amount ? (Number(amount) / 100).toFixed(2) : '—'

  Promise.all([
    // Notify admin
    sendEmail({
      to:        process.env.SUPPORT_EMAIL || 'contact@launcherdesk.com',
      fromName:  'LauncherDesk Payments',
      fromEmail: process.env.EMAIL_FROM_ADDR,
      subject:   `Payment Received: ${serviceTitle || serviceSlug} — ₹${amountInRupees}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <h2 style="color:#0a2540">Payment Received ✅</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;font-weight:600;width:160px">Service</td><td>${serviceTitle || serviceSlug}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600">Amount</td><td>₹${amountInRupees}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600">Customer</td><td>${req.user.name} (${req.user.email})</td></tr>
            <tr><td style="padding:8px 0;font-weight:600">Payment ID</td><td>${razorpay_payment_id}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600">Order ID</td><td>${razorpay_order_id}</td></tr>
          </table>
        </div>
      `,
    }),
    // Confirm to customer
    sendEmail({
      to:        req.user.email,
      fromName:  'LauncherDesk',
      fromEmail: process.env.EMAIL_FROM_ADDR,
      subject:   `Payment confirmed — ${serviceTitle || 'Your Service'}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a2b3c">
          <div style="background:linear-gradient(135deg,#1A2F4E,#1D6FE0);padding:28px;border-radius:12px 12px 0 0;text-align:center">
            <h1 style="color:#fff;font-size:20px;margin:0">Payment Confirmed ✅</h1>
          </div>
          <div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
            <p>Hi <strong>${req.user.name}</strong>,</p>
            <p>We have received your payment of <strong>₹${amountInRupees}</strong> for <strong>${serviceTitle || serviceSlug}</strong>.</p>
            <p>Our team will begin processing your service within <strong>1 business day</strong> and will contact you with next steps.</p>
            <p style="font-size:13px;color:#64748B">Payment ID: ${razorpay_payment_id}</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
            <p style="font-size:12px;color:#94A3B8;text-align:center">LauncherDesk — Startups Made Easy | <a href="https://launcherdesk.com">launcherdesk.com</a></p>
          </div>
        </div>
      `,
    }),
  ]).catch(err => console.error('[Payment email error]', err.message))

  res.json({
    success:   true,
    paymentId: razorpay_payment_id,
    message:   'Payment verified successfully. Our team will be in touch shortly!',
  })
})