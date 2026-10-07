/**
 * Admin API for orders + notifications.  Mounted at /api/admin/ops (admin only).
 *
 * Orders
 *   GET    /orders                          ?status=&q=&page=
 *   GET    /orders/:id                      order + documents + payment + invoices
 *   PATCH  /orders/:id/status               { status, note, notify? }
 *   POST   /orders/:id/assign               { name, designation, email, phone, note }
 *   POST   /orders/:id/action-required      { what, why, how, deadline, ctaUrl }
 *   POST   /orders/:id/request-documents    { names?: [] }   (default list per service)
 *   PATCH  /documents/:docId/review         { decision: 'review'|'approve'|'reject', reason, correction }
 *   POST   /orders/:id/final-documents      multipart "file" + { name }
 *   POST   /orders/:id/documents-ready      → DOCUMENTS_READY email
 *   POST   /orders/:id/cancel               { reason }
 *   POST   /orders/:id/refund               { amount?, reason }  (emails follow Razorpay refund webhooks)
 *   GET    /orders/:id/communications       Communication History
 *   GET    /orders/:id/events               audit log
 * Notifications
 *   GET    /notifications                   ?status=FAILED&templateId=&page=
 *   GET    /notifications/:id               includes rendered HTML
 *   POST   /notifications/:id/resend
 * Templates & settings
 *   GET    /email-templates · GET /email-templates/:templateId
 *   PUT    /email-templates/:templateId     { subject, html, text, ctaLabel, ctaUrlVar, active }
 *   POST   /email-templates/:templateId/preview   { orderId?, customerId?, sampleData? }
 *   DELETE /email-templates/:templateId     reset to built-in default
 *   GET    /notification-settings · PUT /notification-settings
 * Support tickets
 *   GET /tickets · GET /tickets/:ticketId · POST /tickets/:ticketId/reply { message, internal } · PATCH /tickets/:ticketId/status { status }
 */
const router = require('express').Router()
const ServiceOrder = require('../models/ServiceOrder')
const ServiceDocument = require('../models/ServiceDocument')
const Payment = require('../models/Payment')
const Invoice = require('../models/Invoice')
const Notification = require('../models/Notification')
const EventLog = require('../models/EventLog')
const EmailTemplate = require('../models/EmailTemplate')
const NotificationSetting = require('../models/NotificationSetting')
const SupportTicket = require('../models/SupportTicket')
const { protect, restrictTo } = require('../middleware/auth')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { upload } = require('../middleware/privateUpload')
const orderService = require('../services/orderService')
const events = require('../services/events')
const engine = require('../services/notification/engine')
const { TEMPLATES, BY_ID } = require('../services/notification/defaultTemplates')
const { buildVariables } = require('../services/notification/variables')
const { adminRefund } = require('../controllers/paymentController')

router.use(protect, restrictTo('admin'))

const by = req => req.user.email
const page = req => { const p = Math.max(1, parseInt(req.query.page, 10) || 1); const l = Math.min(100, parseInt(req.query.limit, 10) || 25); return { p, l, skip: (p - 1) * l } }
const wrap = fn => asyncHandler(async (req, res, next) => {
  try { await fn(req, res, next) } catch (e) { next(e instanceof AppError ? e : new AppError(e.message, e.statusCode || 500)) }
})
const isSuperAdmin = req => (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(req.user.email.toLowerCase())

/* ── Orders ───────────────────────────────────────────────── */
router.get('/orders', wrap(async (req, res) => {
  const { p, l, skip } = page(req)
  const f = {}
  if (req.query.status) f.status = req.query.status
  if (req.query.q) f.$or = [{ orderNumber: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { serviceTitle: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }]
  const [rows, total] = await Promise.all([
    ServiceOrder.find(f).sort({ createdAt: -1 }).skip(skip).limit(l).populate('user', 'name email phone').lean(),
    ServiceOrder.countDocuments(f),
  ])
  res.json({ success: true, total, page: p, data: rows })
}))

router.get('/orders/:id', wrap(async (req, res, next) => {
  const order = await ServiceOrder.findById(req.params.id).select('+adminNotes').populate('user', 'name email phone emailVerified').lean()
  if (!order) return next(new AppError('Order not found', 404))
  const [documents, payment, invoices] = await Promise.all([
    ServiceDocument.find({ order: order._id }).sort({ createdAt: 1 }).lean(),
    order.payment ? Payment.findById(order.payment).lean() : null,
    Invoice.find({ order: order._id }).lean(),
  ])
  res.json({ success: true, data: { ...order, documents, payment, invoices } })
}))

router.patch('/orders/:id/status', wrap(async (req, res) => {
  const { status, note, notify } = req.body
  const r = await orderService.changeStatus(req.params.id, status, { by: by(req), note, notifyCustomer: notify })
  res.json({ success: true, changed: r.changed, data: r.order })
}))

router.post('/orders/:id/assign', wrap(async (req, res) => {
  const { name, designation, email, phone, note } = req.body
  if (!name) throw new AppError('name is required', 400)
  const r = await orderService.changeStatus(req.params.id, 'ASSIGNED', { by: by(req), note, set: { assignedProfessional: { name, designation, email, phone } } })
  res.json({ success: true, changed: r.changed, data: r.order })
}))

router.post('/orders/:id/action-required', wrap(async (req, res) => {
  const { what, why, how, deadline, ctaUrl } = req.body
  if (!what || !why || !how) throw new AppError('what, why and how are required', 400)
  const order = await ServiceOrder.findById(req.params.id)
  if (!order) throw new AppError('Order not found', 404)
  order.actionRequired = { what, why, how, deadline: deadline ? new Date(deadline) : undefined, ctaUrl }
  await order.save()
  if (order.status === 'ACTION_REQUIRED') {
    // already waiting on the customer → send the new request as its own email
    const n = await EventLog.countDocuments({ order: order._id, eventType: 'ACTION_REQUIRED' })
    await events.emit('ACTION_REQUIRED', { orderId: order._id, triggeredBy: by(req), dedupe: `extra#${n + 1}` })
  } else {
    await orderService.changeStatus(order._id, 'ACTION_REQUIRED', { by: by(req), notifyCustomer: true })
  }
  res.json({ success: true })
}))

router.post('/orders/:id/request-documents', wrap(async (req, res) => {
  const r = await orderService.requestDocuments(req.params.id, { names: req.body.names, by: by(req) })
  res.json({ success: true, created: r.created })
}))

router.patch('/documents/:docId/review', wrap(async (req, res) => {
  const { decision, reason, correction } = req.body
  const doc = await ServiceDocument.findById(req.params.docId)
  if (!doc || doc.type === 'output') throw new AppError('Document not found', 404)
  const order = await ServiceOrder.findById(doc.order)
  doc.reviewedAt = new Date(); doc.reviewedBy = req.user._id

  if (decision === 'review') {
    doc.status = 'UNDER_REVIEW'; await doc.save()
    await orderService.changeStatus(order._id, 'DOCUMENTS_UNDER_REVIEW', { by: by(req) })
  } else if (decision === 'approve') {
    doc.status = 'APPROVED'; doc.rejectionReason = undefined; doc.correctionRequired = undefined; await doc.save()
    const o = await orderService.refreshDocumentStatus(order._id)
    if (o.documentStatus === 'APPROVED') await orderService.changeStatus(order._id, 'DOCUMENTS_APPROVED', { by: by(req) })
  } else if (decision === 'reject') {
    if (!reason || !correction) throw new AppError('reason and correction are required when rejecting', 400)
    Object.assign(doc, { status: 'RESUBMISSION_REQUIRED', rejectionReason: reason, correctionRequired: correction })
    await doc.save()
    await orderService.changeStatus(order._id, 'DOCUMENT_CORRECTION_REQUIRED', {
      by: by(req), notifyCustomer: false, set: { documentStatus: 'CORRECTION_REQUIRED', documentsRequestedAt: new Date(), reminderCount: 0, lastReminderAt: null },
    })
    const n = await EventLog.countDocuments({ order: order._id, eventType: 'DOCUMENT_CORRECTION_REQUIRED', 'metadata.documentId': doc._id })
    await events.emit('DOCUMENT_CORRECTION_REQUIRED', {
      orderId: order._id, triggeredBy: by(req), dedupe: `${doc._id}#${n + 1}`, metadata: { documentId: doc._id },
      extra: { document_name: doc.name, rejection_reason: reason, required_correction: correction },
    })
  } else throw new AppError("decision must be 'review', 'approve' or 'reject'", 400)
  res.json({ success: true, data: doc })
}))

router.post('/orders/:id/final-documents', upload.single('file'), wrap(async (req, res) => {
  const order = await ServiceOrder.findById(req.params.id)
  if (!order) throw new AppError('Order not found', 404)
  if (!req.file) throw new AppError('Please attach a file', 400)
  const doc = await ServiceDocument.create({
    order: order._id, user: order.user, name: req.body.name || req.file.originalname, type: 'output', status: 'APPROVED',
    filename: req.file.originalname, filePath: req.file.filename, mimeType: req.file.mimetype, fileSize: req.file.size,
  })
  res.status(201).json({ success: true, data: doc })
}))

router.post('/orders/:id/documents-ready', wrap(async (req, res) => {
  const count = await ServiceDocument.countDocuments({ order: req.params.id, type: 'output' })
  if (!count) throw new AppError('Upload at least one final document first', 400)
  const r = await orderService.changeStatus(req.params.id, 'DOCUMENTS_READY', { by: by(req), notifyCustomer: true })
  res.json({ success: true, changed: r.changed })
}))

router.post('/orders/:id/cancel', wrap(async (req, res) => {
  const r = await orderService.changeStatus(req.params.id, 'CANCELLED', { by: by(req), notifyCustomer: true, set: { cancellationReason: req.body.reason || 'Cancelled at your request' } })
  res.json({ success: true, changed: r.changed })
}))

router.post('/orders/:id/refund', adminRefund)

router.get('/orders/:id/communications', wrap(async (req, res) => {
  const rows = await Notification.find({ order: req.params.id }).sort({ createdAt: 1 })
    .select('templateId eventType recipientEmail subject status attemptCount sentAt deliveredAt failedAt failureReason nextAttemptAt createdAt resendOf').lean()
  res.json({ success: true, data: rows.map(r => ({ ...r, templateName: BY_ID[r.templateId]?.name || r.templateId })) })
}))

router.get('/orders/:id/events', wrap(async (req, res) => {
  res.json({ success: true, data: await EventLog.find({ order: req.params.id }).sort({ createdAt: 1 }).lean() })
}))

/* ── Notifications ────────────────────────────────────────── */
router.get('/notifications', wrap(async (req, res) => {
  const { p, l, skip } = page(req)
  const f = {}
  if (req.query.status) f.status = req.query.status
  if (req.query.templateId) f.templateId = req.query.templateId
  const [rows, total] = await Promise.all([
    Notification.find(f).sort({ createdAt: -1 }).skip(skip).limit(l).select('-html -text -variables').lean(),
    Notification.countDocuments(f),
  ])
  res.json({ success: true, total, page: p, data: rows })
}))

router.get('/notifications/:id', wrap(async (req, res, next) => {
  const n = await Notification.findById(req.params.id).select('-variables').lean()
  if (!n) return next(new AppError('Not found', 404))
  res.json({ success: true, data: n })
}))

router.post('/notifications/:id/resend', wrap(async (req, res) => {
  const n = await engine.resend(req.params.id, by(req))
  res.json({ success: true, data: n && { _id: n._id, status: n.status, failureReason: n.failureReason } })
}))

/* ── Templates ───────────────────────────────────────────── */
const merged = async () => {
  const overrides = await EmailTemplate.find().lean()
  const byId = Object.fromEntries(overrides.map(o => [o.templateId, o]))
  return TEMPLATES.map(t => {
    const o = byId[t.templateId]
    return {
      templateId: t.templateId, name: t.name, triggerEvent: t.triggerEvent, isSystem: t.isSystem,
      subject: o?.subject || t.subject, html: o?.html || t.body, text: o?.text || '',
      ctaLabel: o?.ctaLabel || t.cta?.label, ctaUrlVar: o?.ctaUrlVar || t.cta?.urlVar,
      active: o ? o.active !== false : true, customised: !!o, updatedAt: o?.updatedAt, updatedBy: o?.updatedBy,
      variables: [...new Set([...(o?.html || t.body).matchAll(/\{\{\{?\s*([a-zA-Z0-9_]+)/g), ...(o?.subject || t.subject).matchAll(/\{\{\{?\s*([a-zA-Z0-9_]+)/g)].map(m => m[1]))],
    }
  })
}

router.get('/email-templates', wrap(async (_req, res) => res.json({ success: true, data: await merged() })))
router.get('/email-templates/:templateId', wrap(async (req, res, next) => {
  const t = (await merged()).find(x => x.templateId === req.params.templateId)
  if (!t) return next(new AppError('Template not found', 404))
  res.json({ success: true, data: t })
}))

router.put('/email-templates/:templateId', wrap(async (req, res) => {
  const base = BY_ID[req.params.templateId]
  if (!base) throw new AppError('Unknown template', 404)
  if (base.isSystem && !isSuperAdmin(req)) throw new AppError('This is a system-critical template. Only super admins (SUPER_ADMIN_EMAILS) can edit it.', 403)
  const { subject, html, text, ctaLabel, ctaUrlVar, active } = req.body
  const doc = await EmailTemplate.findOneAndUpdate(
    { templateId: base.templateId },
    { templateId: base.templateId, name: base.name, triggerEvent: base.triggerEvent, isSystem: base.isSystem,
      subject: subject || base.subject, html: html || base.body, text, ctaLabel: ctaLabel || base.cta?.label, ctaUrlVar: ctaUrlVar || base.cta?.urlVar,
      active: active !== false, updatedBy: by(req) },
    { upsert: true, new: true }
  )
  res.json({ success: true, data: doc })
}))

router.delete('/email-templates/:templateId', wrap(async (req, res) => {
  const base = BY_ID[req.params.templateId]
  if (base?.isSystem && !isSuperAdmin(req)) throw new AppError('Only super admins can reset system templates', 403)
  await EmailTemplate.deleteOne({ templateId: req.params.templateId })
  res.json({ success: true, message: 'Template reset to default' })
}))

router.post('/email-templates/:templateId/preview', wrap(async (req, res) => {
  const sample = {
    customer_name: 'Priya', order_id: 'LD-2026-1006-0001', service_name: 'Private Limited Company Registration', order_status: 'Processing',
    payment_id: 'pay_XXXXXXXX', payment_amount: '₹4,999', total_amount: '₹4,999', invoice_number: 'LD-2026-1006-0002', otp: '123456', otp_expiry_minutes: '10',
    ticket_id: 'TCK-2026-1006-0001', document_name: 'Address proof', rejection_reason: 'The uploaded document is unclear.', required_correction: 'Please upload a clear copy.',
    documents_pending_html: '<ul><li>Address proof</li><li>Photograph</li></ul>', documents_submitted_html: '<ul><li>PAN</li><li>Aadhaar</li></ul>',
    ...(req.body.sampleData || {}),
  }
  const vars = (req.body.orderId || req.body.customerId)
    ? { ...sample, ...(await buildVariables({ orderId: req.body.orderId, customerId: req.body.customerId })) }
    : { ...sample, dashboard_url: '#', order_url: '#', document_upload_url: '#', invoice_url: '#', ticket_url: '#', action_url: '#', documents_url: '#', feedback_url: '#', verification_url: '#' }
  const r = await engine.renderTemplate(req.params.templateId, vars)
  res.json({ success: true, data: { subject: r.subject, html: r.html, text: r.text } })
}))

/* ── Settings ────────────────────────────────────────────── */
const EDITABLE = ['otpExpiryMinutes', 'otpResendCooldownSeconds', 'otpMaxPerHour', 'otpMaxAttempts', 'orderCreatedDelayMinutes',
  'reminder1AfterHours', 'reminder2AfterHours', 'reminder3AfterHours', 'holdAfterFinalReminderHours', 'feedbackDelayHours',
  'retryDelaysMinutes', 'statusEmailEnabled', 'disabledTemplates']

router.get('/notification-settings', wrap(async (_req, res) => res.json({ success: true, data: await NotificationSetting.getSettings() })))
router.put('/notification-settings', wrap(async (req, res) => {
  const s = await NotificationSetting.getSettings()
  for (const k of EDITABLE) if (req.body[k] !== undefined) s[k] = req.body[k]
  s.updatedBy = by(req)
  await s.save()
  res.json({ success: true, data: s })
}))

/* ── Support tickets ─────────────────────────────────────── */
router.get('/tickets', wrap(async (req, res) => {
  const { p, l, skip } = page(req)
  const f = req.query.status ? { status: req.query.status } : {}
  const [rows, total] = await Promise.all([
    SupportTicket.find(f).sort({ updatedAt: -1 }).skip(skip).limit(l).select('-messages').populate('customer', 'name email').lean(),
    SupportTicket.countDocuments(f),
  ])
  res.json({ success: true, total, page: p, data: rows })
}))
const ticketQuery = tid => ({ $or: [{ ticketId: tid }, { ticketCode: tid }, { legacyTicketCode: tid }, { legacyCode: tid }] })

router.get('/tickets/:ticketId', wrap(async (req, res, next) => {
  const t = await SupportTicket.findOne(ticketQuery(req.params.ticketId)).populate('customer', 'name email phone').lean()
  if (!t) return next(new AppError('Ticket not found', 404))
  res.json({ success: true, data: t })
}))
router.post('/tickets/:ticketId/reply', wrap(async (req, res, next) => {
  const t = await SupportTicket.findOne(ticketQuery(req.params.ticketId))
  if (!t) return next(new AppError('Ticket not found', 404))
  const body = String(req.body.message || '').trim()
  if (!body) throw new AppError('message is required', 400)
  const internal = !!req.body.internal
  t.messages.push({ from: 'support', author: req.user.name, body, internal })
  if (!internal && t.status === 'OPEN') t.status = 'IN_PROGRESS'
  await t.save()
  if (!internal) await events.emit('SUPPORT_UPDATED', { customerId: t.customer, ticketId: t._id, orderId: t.order, triggeredBy: by(req), dedupe: `${t.ticketId || t.ticketCode}#${t.messages.length}`, extra: { ticket_message: body.slice(0, 1000) } })
  res.json({ success: true, data: t })
}))
router.patch('/tickets/:ticketId/status', wrap(async (req, res, next) => {
  const t = await SupportTicket.findOne(ticketQuery(req.params.ticketId))
  if (!t) return next(new AppError('Ticket not found', 404))
  const prev = t.status
  t.status = req.body.status
  if (t.status === 'RESOLVED') t.resolvedAt = new Date()
  await t.save()
  if (t.status === 'RESOLVED' && prev !== 'RESOLVED') {
    const n = await EventLog.countDocuments({ customer: t.customer, eventType: 'SUPPORT_RESOLVED', 'metadata.ticketId': t.ticketId })
    await events.emit('SUPPORT_RESOLVED', { customerId: t.customer, ticketId: t._id, orderId: t.order, triggeredBy: by(req), dedupe: `${t.ticketId || t.ticketCode}#${n + 1}`, metadata: { ticketId: t.ticketId || t.ticketCode } })
  }
  res.json({ success: true, data: t })
}))

module.exports = router
