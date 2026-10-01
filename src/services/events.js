/**
 * Event engine — the ONE place the rest of the app reports that something
 * happened. It writes the audit log and decides which customer email(s) to
 * send. Services never build emails themselves.
 *
 *   await events.emit('PAYMENT_SUCCESSFUL', { orderId, paymentId, triggeredBy: 'razorpay', dedupe: paymentId })
 *
 * `dedupe` makes the idempotency key specific when the same event can
 * legitimately happen more than once on an order (e.g. two different
 * document corrections). Without it, an event emails at most once per order.
 */
const EventLog = require('../models/EventLog')
const ServiceOrder = require('../models/ServiceOrder')
const { notify } = require('./notification/engine')

// event → template(s). Status changes are handled by orderService (configurable per status).
const EVENT_TEMPLATES = {
  CUSTOMER_REGISTERED:          ['AUTH_EMAIL_OTP'],
  EMAIL_VERIFIED:               ['AUTH_WELCOME'],
  ORDER_CREATED:                ['ORDER_CREATED'],
  PAYMENT_SUCCESSFUL:           ['PAYMENT_SUCCESS'],
  PAYMENT_FAILED:               ['PAYMENT_FAILED'],
  PAYMENT_PENDING:              ['PAYMENT_PENDING'],
  INVOICE_GENERATED:            ['INVOICE_GENERATED'],
  DOCUMENTS_REQUIRED:           ['DOCUMENTS_REQUIRED'],
  DOCUMENTS_SUBMITTED:          ['DOCUMENTS_RECEIVED'],
  DOCUMENT_REVIEW_STARTED:      ['DOCUMENTS_REVIEW'],
  DOCUMENT_CORRECTION_REQUIRED: ['DOCUMENT_CORRECTION'],
  DOCUMENT_REMINDER_1:          ['DOCUMENT_REMINDER_1'],
  DOCUMENT_REMINDER_2:          ['DOCUMENT_REMINDER_2'],
  DOCUMENT_REMINDER_3:          ['DOCUMENT_REMINDER_3'],
  ORDER_ON_HOLD:                ['ORDER_ON_HOLD'],
  ORDER_ASSIGNED:               ['ORDER_ASSIGNED'],
  PROCESSING_STARTED:           ['PROCESSING_STARTED'],
  EXTERNAL_PROCESSING_STARTED:  ['STATUS_UPDATE'],
  STATUS_UPDATE:                ['STATUS_UPDATE'],
  ACTION_REQUIRED:              ['ACTION_REQUIRED'],
  ORDER_COMPLETED:              ['ORDER_COMPLETED'],
  DOCUMENTS_READY:              ['DOCUMENTS_READY'],
  FEEDBACK_REQUEST:             ['FEEDBACK_REQUEST'],
  SUPPORT_CREATED:              ['SUPPORT_CREATED'],
  SUPPORT_UPDATED:              ['SUPPORT_UPDATED'],
  SUPPORT_RESOLVED:             ['SUPPORT_RESOLVED'],
  ORDER_CANCELLED:              ['ORDER_CANCELLED'],
  REFUND_INITIATED:             ['REFUND_INITIATED'],
  REFUND_COMPLETED:             ['REFUND_COMPLETED'],
}

async function emit(eventType, ctx = {}) {
  const {
    orderId, customerId, paymentId, invoiceId, ticketId, to, extra, triggeredBy = 'system',
    previousStatus, newStatus, metadata, dedupe, delayMinutes, skipIfOrderStatusIn, sensitive, notifyCustomer = true,
  } = ctx

  let order = null
  if (orderId) order = await ServiceOrder.findById(orderId).select('orderNumber user').lean()

  await EventLog.create({
    order: orderId, orderNumber: order?.orderNumber, customer: customerId || order?.user,
    eventType, previousStatus, newStatus, triggeredBy,
    // never log secrets (OTP) — only the keys of extra data
    metadata: { ...(metadata || {}), ...(extra && !sensitive ? { extra } : {}) },
  })

  if (!notifyCustomer) return []
  const results = []
  for (const templateId of EVENT_TEMPLATES[eventType] || []) {
    const idempotencyKey = [orderId || customerId || to, eventType, templateId, dedupe].filter(Boolean).join(':')
    results.push(await notify({
      eventType, templateId, customerId: customerId || order?.user, orderId, paymentId, invoiceId, ticketId,
      to, extra, idempotencyKey, delayMinutes, skipIfOrderStatusIn, sensitive,
    }).catch(err => { console.error(`[Events] ${eventType}/${templateId}:`, err.message); return { status: 'error' } }))
  }
  return results
}

module.exports = { emit, EVENT_TEMPLATES }
