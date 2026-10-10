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
// addGst: true → charge amount + 18% GST (for prices shown as "₹X + GST").
exports.createOrder = asyncHandler(async (req, res, next) => {
  const { amount, currency = 'INR', serviceSlug, serviceTitle } = req.body
  const addGst = req.body.addGst === true || req.body.addGst === 'true'
  if (!amount || isNaN(Number(amount))) return next(new AppError('A valid amount is required', 400))
  const amountNum = Math.round(Number(amount))
  if (amountNum <= 0 || amountNum > 1000000) return next(new AppError('Amount must be between ₹1 and ₹10,00,000', 400))
  if (!serviceSlug) return next(new AppError('serviceSlug is required', 400))

  const price = addGst ? priceWithGst(amountNum) : { feePaise: amountNum * 100, gstPaise: 0, totalPaise: amountNum * 100 }

  const razorpay = getRazorpay()
  const order = await razorpay.orders.create({
    amount:  price.totalPaise,
    currency,
    receipt: `ld_${Date.now()}`,
    notes: {
      userId:       req.user._id.toString(),
      userName:     req.user.name,
      userEmail:    req.user.email,
      serviceSlug:  serviceSlug || '',
      serviceTitle: serviceTitle || '',
      ...(addGst ? { gstIncluded: String(price.gstPaise / 100) } : {}),
    },
  })

  const payment = await Payment.create({
    user:            req.user._id,
    razorpayOrderId: order.id,
    serviceSlug:     serviceSlug || '',
    serviceTitle:    serviceTitle || '',
    amountPaise:     order.amount,
    amountRupees:    order.amount / 100,
    currency,
    status:          'created',
    // Saved so the invoice shows GST on its own line (see services/invoiceService.js).
    ...(addGst ? { breakdown: { feePaise: price.feePaise, gstPaise: price.gstPaise, totalPaise: price.totalPaise } } : {}),
  })

  // LauncherDesk order (LD-YYYY-NNNNNN) linked to this checkout
  const ldOrder = await require('../services/orderService').createOrder({
    userId: req.user._id, serviceSlug, serviceTitle, amount: order.amount / 100, paymentId: payment._id,
  })
  await Payment.updateOne({ _id: payment._id }, { order: ldOrder._id })
  if (addGst) {
    await require('../models/ServiceOrder').updateOne({ _id: ldOrder._id }, {
      professionalFee: price.feePaise / 100, gstAmount: price.gstPaise / 100, totalAmount: price.totalPaise / 100,
    })
  }

  console.log(`[Payment] Order created: ${order.id} — ${ldOrder.orderNumber} — ₹${order.amount / 100}${addGst ? ' (incl. GST)' : ''} — ${req.user.email} — ${serviceSlug}`)

  res.json({
    success:     true,
    orderId:     order.id,
    paymentDbId: payment._id.toString(),
    ldOrderId:   ldOrder._id.toString(),
    orderNumber: ldOrder.orderNumber,
    amount:      order.amount,
    currency:    order.currency,
    keyId:       process.env.RAZORPAY_KEY_ID,
    breakdown:   { feePaise: price.feePaise, gstPaise: price.gstPaise, totalPaise: price.totalPaise, gstRate: addGst ? GST_RATE : 0 },
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

// ── Guest checkout (no login) ────────────────────────────────────────────────
// The customer picks a plan, enters name / email / mobile / city, and pays.
// The price is worked out HERE from the plan, never taken from the browser.
// The order is attached to the account that matches the email (a basic account
// is created if there is none yet, so the order shows up when they sign in).

const { priceFor, priceWithGst, SERVICE_TITLES, GST_RATE, TRADEMARK, trademarkPrice, ESTAMP, estampPrice } = require('../config/planPrices')
const User = require('../models/User')

async function findOrCreateCustomer({ name, email, phone, city }) {
  let user = await User.findOne({ email })
  if (!user) {
    user = await User.create({
      name, email, phone, city,
      // Random password: they can claim the account later with "Forgot password".
      password: crypto.randomBytes(24).toString('hex'),
    })
  } else {
    // Only fill in details that are missing; never overwrite an existing account's data.
    const patch = {}
    if (!user.phone && phone) patch.phone = phone
    if (!user.city && city) patch.city = city
    if (Object.keys(patch).length) await User.updateOne({ _id: user._id }, patch)
  }
  return user
}

// POST /api/payments/checkout/create-order — public
exports.createCheckoutOrder = asyncHandler(async (req, res, next) => {
  const { serviceSlug, tier, name, email, mobile, city, whatsappOptIn } = req.body

  const price = priceFor(serviceSlug, tier)
  if (!price) return next(new AppError('This plan is not available for online payment. Please contact us.', 400))

  const razorpay = getRazorpay()
  const serviceTitle = `${SERVICE_TITLES[serviceSlug]} — ${tier} Plan`
  const orderSlug = `${serviceSlug}-${tier.toLowerCase()}`
  const customer = { name, email, phone: mobile, city, whatsappOptIn: !!whatsappOptIn }

  const user = await findOrCreateCustomer({ name, email, phone: mobile, city })

  const order = await razorpay.orders.create({
    amount: price.totalPaise,
    currency: 'INR',
    receipt: `ld_${Date.now()}`,
    notes: {
      userId: user._id.toString(), userName: name, userEmail: email, userPhone: mobile, city,
      serviceSlug: orderSlug, serviceTitle, gstIncluded: String(price.gstPaise / 100),
    },
  })

  const payment = await Payment.create({
    user: user._id,
    razorpayOrderId: order.id,
    serviceSlug: orderSlug,
    serviceTitle,
    amountPaise: order.amount,
    amountRupees: order.amount / 100,
    currency: 'INR',
    status: 'created',
    customer,
    breakdown: { feePaise: price.feePaise, gstPaise: price.gstPaise, totalPaise: price.totalPaise, tier },
  })

  const ldOrder = await require('../services/orderService').createOrder({
    userId: user._id, serviceSlug: orderSlug, serviceTitle, amount: order.amount / 100, paymentId: payment._id,
  })
  await Payment.updateOne({ _id: payment._id }, { order: ldOrder._id })
  await require('../models/ServiceOrder').updateOne({ _id: ldOrder._id }, {
    professionalFee: price.feePaise / 100, gstAmount: price.gstPaise / 100, totalAmount: price.totalPaise / 100,
  })

  console.log(`[Payment] Guest order created: ${order.id} — ${ldOrder.orderNumber} — ₹${order.amount / 100} — ${email} — ${orderSlug}`)

  res.json({
    success: true,
    orderId: order.id,
    orderNumber: ldOrder.orderNumber,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    breakdown: { feePaise: price.feePaise, gstPaise: price.gstPaise, totalPaise: price.totalPaise, gstRate: GST_RATE },
  })
})

// POST /api/payments/checkout/trademark/create-order — public
// Amount charged = professional fee + 18% GST (on the fee only) + government fee
// for the chosen applicant type and number of classes. All worked out here.
exports.createTrademarkOrder = asyncHandler(async (req, res, next) => {
  const { name, email, mobile, city, applicantType, classes, classNumbers, expertToChoose, brandName, whatsappOptIn } = req.body

  const price = trademarkPrice({ applicantType, classes, classNumbers })
  if (!price) return next(new AppError('Please choose a valid applicant type and number of classes.', 400))
  const { looksLikePdf } = require('../middleware/trademarkLogo')
  if (req.file && !looksLikePdf(req.file.buffer)) return next(new AppError('Logo must be a PDF file', 400))

  const razorpay = getRazorpay()
  const orderSlug = TRADEMARK.slug
  const serviceTitle = `${TRADEMARK.title} — ${price.classes} ${price.classes === 1 ? 'class' : 'classes'}`
  const customer = { name, email, phone: mobile, city, whatsappOptIn: !!whatsappOptIn }

  const user = await findOrCreateCustomer({ name, email, phone: mobile, city })

  const order = await razorpay.orders.create({
    amount: price.totalPaise,
    currency: 'INR',
    receipt: `ld_${Date.now()}`,
    notes: {
      userId: user._id.toString(), userName: name, userEmail: email, userPhone: mobile, city,
      serviceSlug: orderSlug, serviceTitle, applicantType, classes: String(price.classes),
      classNumbers: price.classNumbers.join(',') || 'expert to choose',
      brandName: brandName || '', gstIncluded: String(price.gstPaise / 100), logoUploaded: String(!!req.file),
      govtFee: String(price.govtPaise / 100), govtFeeCollected: String(price.govtCollected),
    },
  })

  const payment = await Payment.create({
    user: user._id,
    razorpayOrderId: order.id,
    serviceSlug: orderSlug,
    serviceTitle,
    amountPaise: order.amount,
    amountRupees: order.amount / 100,
    currency: 'INR',
    status: 'created',
    customer,
    breakdown: {
      feePaise: price.feePaise, gstPaise: price.gstPaise, govtPaise: price.govtPaise,
      govtCollected: price.govtCollected, totalPaise: price.totalPaise,
    },
    trademark: {
      applicantType, classes: price.classes, brandName: brandName || '',
      classNumbers: price.classNumbers, expertToChoose: !price.classNumbers.length && !!expertToChoose,
    },
  })

  const ldOrder = await require('../services/orderService').createOrder({
    userId: user._id, serviceSlug: orderSlug, serviceTitle, amount: order.amount / 100, paymentId: payment._id,
  })
  await Payment.updateOne({ _id: payment._id }, { order: ldOrder._id })
  await require('../models/ServiceOrder').updateOne({ _id: ldOrder._id }, {
    professionalFee: price.feePaise / 100, gstAmount: price.gstPaise / 100,
    govtFee: price.govtPaise / 100, totalAmount: price.totalPaise / 100,
  })

  // Brand logo (optional, PDF). Saved against the order as the "Brand name / logo file"
  // document, so the customer is not asked for it again after payment.
  if (req.file) {
    const fs = require('fs')
    const path = require('path')
    const { DIR } = require('../middleware/privateUpload')
    const stored = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.pdf`
    await fs.promises.writeFile(path.join(DIR, stored), req.file.buffer)
    await require('../models/ServiceDocument').create({
      order: ldOrder._id, user: user._id, name: 'Brand name / logo file', type: 'submitted',
      description: brandName ? `Logo for "${brandName}"` : 'Brand logo',
      filename: req.file.originalname, filePath: stored, mimeType: 'application/pdf', fileSize: req.file.size,
      status: 'UPLOADED',
    })
  }

  console.log(`[Payment] Trademark order created: ${order.id} — ${ldOrder.orderNumber} — ₹${order.amount / 100} — ${email} — ${price.classes} class(es)${price.classNumbers.length ? ` [${price.classNumbers.join(', ')}]` : ''}, ${applicantType}, ${city}${req.file ? ', logo attached' : ''}`)

  res.json({
    success: true,
    orderId: order.id,
    orderNumber: ldOrder.orderNumber,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    breakdown: {
      feePaise: price.feePaise, gstPaise: price.gstPaise, govtPaise: price.govtPaise,
      govtCollected: price.govtCollected, totalPaise: price.totalPaise, gstRate: GST_RATE,
    },
  })
})

// POST /api/payments/checkout/estamp/create-order — logged-in customers
// Amount = stamp duty (at actual, no GST) + LauncherDesk fees + 18% GST on the fees.
// Everything is recalculated here from config/planPrices.js; the browser only sends choices.
exports.createEStampOrder = asyncHandler(async (req, res, next) => {
  const b = req.body
  if (!ESTAMP.states.includes(b.state)) return next(new AppError('Please choose a valid state', 400))
  // Articles: for verified states the article must exist; where the state's rules fix or
  // calculate the duty, the server recalculates it and rejects a different amount.
  const { STATE_ARTICLES, dutyFromRule } = require('../config/estampArticles')
  let articleRule = null
  if (STATE_ARTICLES[b.state] && b.articleCode) {
    const art = STATE_ARTICLES[b.state].find(a => a.code === b.articleCode && a.label === b.documentType)
    if (!art) return next(new AppError('Please choose the document type from the list', 400))
    if (art.rule && art.rule.type !== 'text') {
      const base = art.rule.base === 'Consideration amount' ? b.consideration : b.baseAmount
      const r = dutyFromRule(art.rule, base)
      if (!r || r.error) return next(new AppError(r?.error || 'Enter the amount needed to work out the stamp duty', 400))
      if (Number(b.stampDuty) !== r.duty) return next(new AppError(`The stamp duty for this article is ₹${r.duty.toLocaleString('en-IN')}`, 400))
      articleRule = { base: art.rule.base, baseAmount: Number(base) }
    }
  }
  const price = estampPrice({ stampDuty: b.stampDuty, delivery: b.delivery })
  if (!price) return next(new AppError(`Stamp duty must be a whole amount between ₹${ESTAMP.minDuty} and ₹${ESTAMP.maxDuty.toLocaleString('en-IN')}`, 400))

  const stateName = b.stateName || b.state
  const duty = price.dutyPaise / 100
  const orderSlug = b.printDocument ? 'e-stamp-paper-print' : 'e-stamp-paper'
  const serviceTitle = `e-Stamp Paper — ${stateName} (₹${duty.toLocaleString('en-IN')})`
  const customer = { name: b.name, email: b.email, phone: b.mobile, city: b.city || '' }
  const details = {
    kind: 'e-stamp', state: stateName, firstParty: b.firstParty, secondParty: b.secondParty, stampDutyPaidBy: b.payer,
    documentType: b.articleCode ? `Article ${b.articleCode} ${b.documentType}` : b.documentType, purpose: b.purpose,
    ...(articleRule ? { dutyCalculatedFrom: `${articleRule.base}: ₹${articleRule.baseAmount.toLocaleString('en-IN')}` } : {}),
    considerationAmount: b.consideration !== undefined && b.consideration !== '' ? Number(b.consideration) : null,
    stampDuty: duty, printDocumentOnStamp: !!b.printDocument,
    delivery: b.delivery === 'courier' ? 'Email scan + courier' : 'Email scan only',
    contact: { name: b.name, mobile: b.mobile, email: b.email },
    ...(b.delivery === 'courier' ? { deliveryAddress: { address: b.address, city: b.city, pincode: b.pincode, state: stateName } } : {}),
  }

  const razorpay = getRazorpay()
  const order = await razorpay.orders.create({
    amount: price.totalPaise,
    currency: 'INR',
    receipt: `ld_${Date.now()}`,
    notes: {
      userId: req.user._id.toString(), userName: b.name, userEmail: b.email, userPhone: b.mobile,
      serviceSlug: orderSlug, serviceTitle, state: stateName, stampDuty: String(duty),
      firstParty: String(b.firstParty).slice(0, 200), secondParty: String(b.secondParty).slice(0, 200),
    },
  })

  const payment = await Payment.create({
    user: req.user._id,
    razorpayOrderId: order.id,
    serviceSlug: orderSlug,
    serviceTitle,
    amountPaise: order.amount,
    amountRupees: order.amount / 100,
    currency: 'INR',
    status: 'created',
    customer,
    // Stamp duty is a government levy passed through at actual → shown as its own invoice line.
    breakdown: { feePaise: price.feePaise, gstPaise: price.gstPaise, govtPaise: price.dutyPaise, govtCollected: true, totalPaise: price.totalPaise },
  })

  const ldOrder = await require('../services/orderService').createOrder({
    userId: req.user._id, serviceSlug: orderSlug, serviceTitle, amount: order.amount / 100, paymentId: payment._id,
  })
  await Payment.updateOne({ _id: payment._id }, { order: ldOrder._id })
  await require('../models/ServiceOrder').updateOne({ _id: ldOrder._id }, {
    professionalFee: price.feePaise / 100, gstAmount: price.gstPaise / 100,
    govtFee: price.dutyPaise / 100, totalAmount: price.totalPaise / 100, details,
  })

  console.log(`[Payment] e-Stamp order created: ${order.id} — ${ldOrder.orderNumber} — ₹${order.amount / 100} — ${req.user.email} — ${stateName}, duty ₹${duty}`)

  res.json({
    success: true,
    orderId: order.id,
    orderNumber: ldOrder.orderNumber,
    ldOrderId: ldOrder._id.toString(),
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    breakdown: { dutyPaise: price.dutyPaise, feePaise: price.feePaise, gstPaise: price.gstPaise, totalPaise: price.totalPaise, gstRate: GST_RATE },
  })
})

// POST /api/payments/checkout/estamp/callback — public, hit by Razorpay itself.
// Used on phones, where the checkout pop-up can fail to appear: the app sends the customer to
// Razorpay's full-page checkout (redirect mode) and Razorpay POSTs the result here, as a browser
// form post. We verify the signature (same proof as /verify), mark the order paid, then send the
// customer back to the e-stamp page, which shows the success / failure state.
exports.estampCallback = asyncHandler(async (req, res) => {
  const site = (process.env.CLIENT_URL || 'https://launcherdesk.com').split(',')[0].trim().replace(/\/$/, '')
  const b = req.body || {}
  const back = (q) => res.redirect(303, `${site}/estamp/${encodeURIComponent(q.state || '')}?${new URLSearchParams(q.params).toString()}`)

  const orderId = b.razorpay_order_id
  const payment = orderId ? await Payment.findOne({ razorpayOrderId: orderId }) : null
  const state = String(req.query.state || '').replace(/[^a-z0-9-]/gi, '')

  if (!payment || !b.razorpay_payment_id || !b.razorpay_signature) {
    const msg = (b.error && (b.error.description || b.error['description'])) || b['error[description]'] || "The payment didn't go through. No money was taken; you can try again."
    return back({ state, params: { payfail: String(msg).slice(0, 200) } })
  }

  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${b.razorpay_payment_id}`).digest('hex')
  const given = String(b.razorpay_signature)
  const sigOk = expected.length === given.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))
  if (!sigOk) {
    console.warn(`[Payment] Signature mismatch on estamp callback: ${orderId}`)
    return back({ state, params: { payfail: "We couldn't confirm your payment. If money was deducted, please contact support@launcherdesk.com." } })
  }

  const { order } = await require('../services/paymentService').markPaid({
    razorpayOrderId: orderId, razorpayPaymentId: b.razorpay_payment_id, source: 'customer',
  })
  console.log(`[Payment] e-Stamp callback verified: ${b.razorpay_payment_id}`)
  return back({ state, params: { paid: order?.orderNumber || 'ok', ...(order?._id ? { oid: String(order._id) } : {}) } })
})

// POST /api/payments/checkout/verify — public; the Razorpay signature is the proof of payment
exports.verifyCheckoutPayment = asyncHandler(async (req, res, next) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return next(new AppError('Payment verification data missing', 400))
  }
  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id })
  if (!payment) return next(new AppError('Payment record not found', 404))

  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex')
  const given = String(razorpay_signature)
  const sigOk = expected.length === given.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))
  if (!sigOk) {
    console.warn(`[Payment] Signature mismatch on guest verify: ${razorpay_order_id}`)
    return next(new AppError('Payment verification failed — please contact support', 400))
  }

  const { order, alreadyProcessed } = await require('../services/paymentService').markPaid({
    razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id, source: 'customer',
  })
  console.log(`[Payment] Guest verified${alreadyProcessed ? ' (already processed)' : ''}: ${razorpay_payment_id}`)
  res.json({
    success: true, orderNumber: order?.orderNumber,
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