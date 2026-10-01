/**
 * Order management: order IDs, the central status engine and document requests.
 * Every status change goes through changeStatus() so it is logged and the
 * right customer email (if enabled in settings) is sent exactly once.
 */
const ServiceOrder = require('../models/ServiceOrder')
const ServiceDocument = require('../models/ServiceDocument')
const EventLog = require('../models/EventLog')
const Counter = require('../models/Counter')
const NotificationSetting = require('../models/NotificationSetting')
const events = require('./events')
const { documentsFor } = require('../data/serviceDocuments')

const STATUSES = [
  'CREATED', 'PAYMENT_PENDING', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'DOCUMENTS_PENDING', 'DOCUMENTS_SUBMITTED',
  'DOCUMENTS_UNDER_REVIEW', 'DOCUMENT_CORRECTION_REQUIRED', 'DOCUMENTS_APPROVED', 'ASSIGNED', 'PROCESSING',
  'GOVERNMENT_PROCESSING', 'ACTION_REQUIRED', 'ON_HOLD', 'COMPLETED', 'DOCUMENTS_READY', 'CANCELLED',
  'REFUND_INITIATED', 'REFUNDED', 'CLOSED',
]

// Status → the specific event (and therefore email) it triggers. Others use STATUS_UPDATE.
const STATUS_EVENT = {
  DOCUMENTS_UNDER_REVIEW: 'DOCUMENT_REVIEW_STARTED',
  ASSIGNED: 'ORDER_ASSIGNED',
  PROCESSING: 'PROCESSING_STARTED',
  GOVERNMENT_PROCESSING: 'EXTERNAL_PROCESSING_STARTED',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  ON_HOLD: 'ORDER_ON_HOLD',
  COMPLETED: 'ORDER_COMPLETED',
  DOCUMENTS_READY: 'DOCUMENTS_READY',
  CANCELLED: 'ORDER_CANCELLED',
}
// These are emailed by their own workflow (payments, documents, refunds), never by a plain status change.
const WORKFLOW_STATUSES = ['CREATED', 'PAYMENT_PENDING', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'DOCUMENTS_PENDING',
  'DOCUMENTS_SUBMITTED', 'DOCUMENT_CORRECTION_REQUIRED', 'REFUND_INITIATED', 'REFUNDED']

const STATUS_MESSAGES = {
  DOCUMENTS_APPROVED: 'Your documents have been approved. We are moving your order to the next stage.',
  GOVERNMENT_PROCESSING: 'Your application has been submitted to the relevant authority and is currently under processing. Timelines depend on the authority, and we will update you as soon as there is progress.',
  CLOSED: 'Your order has been closed.',
}

async function generateOrderNumber(date = new Date()) {
  const year = date.getFullYear()
  const seq = await Counter.next(`order-${year}`)
  return `LD-${year}-${String(seq).padStart(6, '0')}`
}

async function createOrder({ userId, serviceSlug, serviceTitle, serviceCategory, amount, paymentId, triggeredBy = 'customer' }) {
  const order = await ServiceOrder.create({
    orderNumber: await generateOrderNumber(),
    user: userId, serviceSlug, serviceTitle: serviceTitle || serviceSlug, serviceCategory,
    payment: paymentId, baseAmount: amount, professionalFee: amount, totalAmount: amount, discount: 0,
    status: 'PAYMENT_PENDING', paymentStatus: 'PAYMENT_PENDING', documentStatus: 'PENDING',
  })
  const settings = await NotificationSetting.getSettings()
  // The "order created / complete your payment" email is delayed and skipped automatically
  // if the customer pays in the meantime — no noise for people who pay straight away.
  await events.emit('ORDER_CREATED', {
    orderId: order._id, triggeredBy, newStatus: 'PAYMENT_PENDING',
    delayMinutes: settings.orderCreatedDelayMinutes,
    skipIfOrderStatusIn: STATUSES.filter(s => !['CREATED', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(s)),
  })
  return order
}

/**
 * Change an order's status. Same status twice = no-op (no duplicate email).
 * @param {object} opts { by, note, notifyCustomer (default: per settings), extra, set (extra fields to update) }
 */
async function changeStatus(orderId, newStatus, opts = {}) {
  if (!STATUSES.includes(newStatus)) throw Object.assign(new Error(`Invalid status ${newStatus}`), { statusCode: 400 })
  const { by = 'system', note, extra, set = {} } = opts
  const order = await ServiceOrder.findById(orderId)
  if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 })
  const previous = order.status
  Object.assign(order, set)
  if (previous === newStatus) { await order.save(); return { order, changed: false } }

  order.status = newStatus
  if (newStatus === 'PROCESSING' && !order.startedAt) order.startedAt = new Date()
  if (newStatus === 'COMPLETED') order.completedAt = order.completedAt || new Date()
  if (newStatus === 'CANCELLED') order.cancelledAt = new Date()
  await order.save()

  // How many times has the order entered this status before? Makes the email key unique per entry.
  const times = await EventLog.countDocuments({ order: order._id, eventType: 'STATUS_CHANGED', newStatus })
  const settings = await NotificationSetting.getSettings()
  const enabled = opts.notifyCustomer ?? (!WORKFLOW_STATUSES.includes(newStatus) && settings.statusEmailEnabled?.get?.(newStatus) === true)

  await EventLog.create({ order: order._id, orderNumber: order.orderNumber, customer: order.user, eventType: 'STATUS_CHANGED', previousStatus: previous, newStatus, triggeredBy: by, metadata: note ? { note } : undefined })

  if (enabled) {
    const evt = STATUS_EVENT[newStatus] || 'STATUS_UPDATE'
    await events.emit(evt, {
      orderId: order._id, triggeredBy: by, previousStatus: previous, newStatus, dedupe: `${newStatus}#${times + 1}`,
      extra: { status_message: STATUS_MESSAGES[newStatus] || `Your order status is now: ${newStatus.replace(/_/g, ' ').toLowerCase()}.`, next_step: note || 'Our team will contact you if anything is needed.', ...(extra || {}) },
    })
  }
  return { order, changed: true }
}

/** Create the required-document checklist for an order and email the customer. */
async function requestDocuments(orderId, { names, by = 'system' } = {}) {
  const order = await ServiceOrder.findById(orderId)
  if (!order) throw new Error('Order not found')
  const wanted = names?.length ? names : documentsFor(order.serviceSlug)
  if (!wanted.length) {
    order.documentStatus = 'NOT_REQUIRED'; await order.save()
    return { order, created: 0 }
  }
  const existing = await ServiceDocument.find({ order: order._id, type: { $ne: 'output' } }).select('name').lean()
  const have = new Set(existing.map(d => d.name.toLowerCase()))
  const toCreate = wanted.filter(n => !have.has(n.toLowerCase()))
  if (toCreate.length) await ServiceDocument.insertMany(toCreate.map(name => ({ order: order._id, user: order.user, name, type: 'required', status: 'PENDING' })))

  order.documentsRequestedAt = new Date(); order.reminderCount = 0; order.lastReminderAt = undefined
  order.documentStatus = 'PENDING'
  await order.save()
  await changeStatus(order._id, 'DOCUMENTS_PENDING', { by, notifyCustomer: false })
  const n = await EventLog.countDocuments({ order: order._id, eventType: 'DOCUMENTS_REQUIRED' })
  await events.emit('DOCUMENTS_REQUIRED', { orderId: order._id, triggeredBy: by, dedupe: `#${n + 1}` })
  return { order, created: toCreate.length }
}

/** Recalculate order.documentStatus from its documents. */
async function refreshDocumentStatus(orderId) {
  const docs = await ServiceDocument.find({ order: orderId, type: { $ne: 'output' } }).lean()
  const order = await ServiceOrder.findById(orderId)
  if (!order) return null
  const st = docs.map(d => d.status)
  let ds = 'NOT_REQUIRED'
  if (docs.length) {
    if (st.some(s => ['REJECTED', 'RESUBMISSION_REQUIRED', 'rejected'].includes(s))) ds = 'CORRECTION_REQUIRED'
    else if (st.every(s => ['APPROVED', 'accepted', 'NOT_REQUIRED'].includes(s))) ds = 'APPROVED'
    else if (st.some(s => ['PENDING', 'pending'].includes(s))) ds = 'PENDING'
    else if (st.some(s => ['UNDER_REVIEW', 'under-review'].includes(s))) ds = 'UNDER_REVIEW'
    else ds = 'SUBMITTED'
  }
  order.documentStatus = ds
  await order.save()
  return order
}

module.exports = { STATUSES, generateOrderNumber, createOrder, changeStatus, requestDocuments, refreshDocumentStatus }
