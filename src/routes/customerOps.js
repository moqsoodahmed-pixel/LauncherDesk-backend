/**
 * Customer dashboard API for the notification/order workflow.  Mounted at /api/user (protected).
 *   GET  /orders/:id/documents                    checklist + final documents
 *   POST /orders/:id/documents/:docId/upload      multipart field "file"
 *   POST /orders/:id/documents/submit             "I've uploaded my documents" → DOCUMENTS_RECEIVED email
 *   GET  /orders/:id/documents/:docId/download    authenticated download (never a public URL)
 *   GET  /orders/:id/timeline                     customer-safe status history
 *   GET  /invoices · GET /invoices/:id/pdf
 *   POST /tickets · GET /tickets · GET /tickets/:ticketId · POST /tickets/:ticketId/messages
 */
const router = require('express').Router()
const ServiceOrder = require('../models/ServiceOrder')
const ServiceDocument = require('../models/ServiceDocument')
const EventLog = require('../models/EventLog')
const Invoice = require('../models/Invoice')
const SupportTicket = require('../models/SupportTicket')
const Counter = require('../models/Counter')
const { protect } = require('../middleware/auth')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { upload, resolveFile } = require('../middleware/privateUpload')
const orderService = require('../services/orderService')
const events = require('../services/events')
const { invoicePdf } = require('../services/invoiceService')

router.use(protect)

const ownOrder = async (req) => {
  const o = await ServiceOrder.findOne({ _id: req.params.id, user: req.user._id })
  if (!o) throw new AppError('Order not found', 404)
  return o
}
const publicDoc = d => ({
  _id: d._id, name: d.name, description: d.description, type: d.type, status: d.status,
  filename: d.filename, fileSize: d.fileSize, rejectionReason: d.rejectionReason,
  correctionRequired: d.correctionRequired, updatedAt: d.updatedAt,
})

router.get('/orders/:id/documents', asyncHandler(async (req, res) => {
  const order = await ownOrder(req)
  const docs = await ServiceDocument.find({ order: order._id }).sort({ createdAt: 1 }).lean()
  res.json({
    success: true, orderNumber: order.orderNumber, documentStatus: order.documentStatus,
    required: docs.filter(d => d.type !== 'output').map(publicDoc),
    final: docs.filter(d => d.type === 'output').map(publicDoc),
  })
}))

router.post('/orders/:id/documents/:docId/upload', upload.single('file'), asyncHandler(async (req, res, next) => {
  const order = await ownOrder(req)
  if (!req.file) return next(new AppError('Please attach a file', 400))
  const doc = await ServiceDocument.findOne({ _id: req.params.docId, order: order._id, type: { $ne: 'output' } })
  if (!doc) return next(new AppError('Document not found', 404))
  if (['APPROVED', 'accepted'].includes(doc.status)) return next(new AppError('This document is already approved', 400))
  Object.assign(doc, { filename: req.file.originalname, filePath: req.file.filename, mimeType: req.file.mimetype, fileSize: req.file.size, status: 'UPLOADED', rejectionReason: undefined, correctionRequired: undefined })
  await doc.save()
  await orderService.refreshDocumentStatus(order._id)
  await EventLog.create({ order: order._id, orderNumber: order.orderNumber, customer: order.user, eventType: 'DOCUMENT_UPLOADED', triggeredBy: 'customer', metadata: { documentId: doc._id, name: doc.name } })
  res.json({ success: true, data: publicDoc(doc) })
}))

router.post('/orders/:id/documents/submit', asyncHandler(async (req, res, next) => {
  const order = await ownOrder(req)
  const docs = await ServiceDocument.find({ order: order._id, type: { $ne: 'output' } }).lean()
  const uploaded = docs.filter(d => d.status === 'UPLOADED')
  if (!uploaded.length) return next(new AppError('Upload at least one document first', 400))
  const pending = docs.filter(d => ['PENDING', 'RESUBMISSION_REQUIRED', 'REJECTED', 'pending', 'rejected'].includes(d.status))
  if (!pending.length) await orderService.changeStatus(order._id, 'DOCUMENTS_SUBMITTED', { by: 'customer', notifyCustomer: false })
  const n = await EventLog.countDocuments({ order: order._id, eventType: 'DOCUMENTS_SUBMITTED' })
  await events.emit('DOCUMENTS_SUBMITTED', { orderId: order._id, triggeredBy: 'customer', dedupe: `#${n + 1}`, metadata: { uploaded: uploaded.length, pending: pending.length } })
  res.json({ success: true, submitted: uploaded.length, pending: pending.length })
}))

router.get('/orders/:id/documents/:docId/download', asyncHandler(async (req, res, next) => {
  const order = await ownOrder(req)
  const doc = await ServiceDocument.findOne({ _id: req.params.docId, order: order._id })
  const file = doc && resolveFile(doc.filePath)
  if (!file) return next(new AppError('File not found', 404))
  res.setHeader('Cache-Control', 'private, no-store')
  res.download(file, doc.filename || 'document')
}))

router.get('/orders/:id/timeline', asyncHandler(async (req, res) => {
  const order = await ownOrder(req)
  const rows = await EventLog.find({ order: order._id, eventType: 'STATUS_CHANGED' }).sort({ createdAt: 1 }).select('previousStatus newStatus createdAt').lean()
  res.json({ success: true, orderNumber: order.orderNumber, status: order.status, timeline: rows })
}))

router.get('/invoices', asyncHandler(async (req, res) => {
  const rows = await Invoice.find({ customer: req.user._id }).sort({ invoiceDate: -1 }).lean()
  res.json({ success: true, data: rows })
}))

router.get('/invoices/:id/pdf', asyncHandler(async (req, res, next) => {
  const inv = await Invoice.findOne({ _id: req.params.id, customer: req.user._id }).lean()
  if (!inv) return next(new AppError('Invoice not found', 404))
  const pdf = await invoicePdf(inv)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${inv.invoiceNumber.replace(/\//g, '-')}.pdf"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(pdf)
}))

/* ── Support tickets ── */
const customerTicket = t => ({ ...t, messages: (t.messages || []).filter(m => !m.internal) })

const { generateTicketCode } = require('../services/idGenerator.service')

router.post('/tickets', asyncHandler(async (req, res, next) => {
  const { subject, message, orderId } = req.body
  if (!subject?.trim() || !message?.trim()) return next(new AppError('Subject and message are required', 400))
  let order = null
  if (orderId) order = await ServiceOrder.findOne({ _id: orderId, user: req.user._id }).select('_id')
  const ticketCode = await generateTicketCode()
  const t = await SupportTicket.create({
    ticketId: ticketCode,
    ticketCode,
    customer: req.user._id,
    order: order?._id,
    subject: subject.trim().slice(0, 200),
    messages: [{ from: 'customer', author: req.user.name, body: message.trim().slice(0, 5000) }],
  })
  await events.emit('SUPPORT_CREATED', { customerId: req.user._id, orderId: order?._id, ticketId: t._id, triggeredBy: 'customer', dedupe: t.ticketId })
  res.status(201).json({ success: true, data: customerTicket(t.toObject()) })
}))

router.get('/tickets', asyncHandler(async (req, res) => {
  const rows = await SupportTicket.find({ customer: req.user._id }).sort({ updatedAt: -1 }).select('-messages').lean()
  res.json({ success: true, data: rows })
}))

router.get('/tickets/:ticketId', asyncHandler(async (req, res, next) => {
  const tid = req.params.ticketId
  const t = await SupportTicket.findOne({
    $or: [{ ticketId: tid }, { ticketCode: tid }, { legacyTicketCode: tid }, { legacyCode: tid }],
    customer: req.user._id,
  }).lean()
  if (!t) return next(new AppError('Ticket not found', 404))
  res.json({ success: true, data: customerTicket(t) })
}))

router.post('/tickets/:ticketId/messages', asyncHandler(async (req, res, next) => {
  const tid = req.params.ticketId
  const t = await SupportTicket.findOne({
    $or: [{ ticketId: tid }, { ticketCode: tid }, { legacyTicketCode: tid }, { legacyCode: tid }],
    customer: req.user._id,
  })
  if (!t) return next(new AppError('Ticket not found', 404))
  if (!req.body.message?.trim()) return next(new AppError('Message is required', 400))
  t.messages.push({ from: 'customer', author: req.user.name, body: req.body.message.trim().slice(0, 5000) })
  if (['RESOLVED', 'CLOSED', 'WAITING_ON_CUSTOMER'].includes(t.status)) t.status = 'OPEN'
  await t.save()
  res.json({ success: true, data: customerTicket(t.toObject()) })
}))

module.exports = router
