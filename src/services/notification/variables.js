/**
 * Builds the {{variables}} for a template from the database, so callers only
 * pass IDs (customerId / orderId / ticketId ...) instead of every field.
 * Dashboard paths live in URLS so they can be changed in one place.
 */
const User = require('../../models/User')
const ServiceOrder = require('../../models/ServiceOrder')
const ServiceDocument = require('../../models/ServiceDocument')
const Payment = require('../../models/Payment')
const Invoice = require('../../models/Invoice')
const SupportTicket = require('../../models/SupportTicket')
const { esc } = require('./render')

const site = () => (process.env.CLIENT_URL || 'https://launcherdesk.com').replace(/\/$/, '')
const URLS = {
  dashboard: () => `${site()}/user/dashboard`,
  order:     id => `${site()}/user/services/${id}`,
  documents: id => `${site()}/user/services/${id}?tab=documents`,
  invoices:  () => `${site()}/user/payments`,
  ticket:    id => `${site()}/user/dashboard?tab=support&ticket=${id}`,
  support:   () => `${site()}/user/dashboard?tab=support`,
  feedback:  id => `${site()}/user/services/${id}?tab=feedback`,
  verify:    () => `${site()}/user/verify-email`,
}

const inr = n => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : '')
const date = d => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '')

const STATUS_LABELS = {
  CREATED: 'Created', PAYMENT_PENDING: 'Payment pending', PAYMENT_SUCCESSFUL: 'Payment received', PAYMENT_FAILED: 'Payment failed',
  DOCUMENTS_PENDING: 'Documents pending', DOCUMENTS_SUBMITTED: 'Documents submitted', DOCUMENTS_UNDER_REVIEW: 'Documents under review',
  DOCUMENT_CORRECTION_REQUIRED: 'Document correction required', DOCUMENTS_APPROVED: 'Documents approved', ASSIGNED: 'Assigned',
  PROCESSING: 'Processing', GOVERNMENT_PROCESSING: 'Under processing with the authority', ACTION_REQUIRED: 'Action required from you',
  ON_HOLD: 'On hold', COMPLETED: 'Completed', DOCUMENTS_READY: 'Final documents ready', CANCELLED: 'Cancelled',
  REFUND_INITIATED: 'Refund initiated', REFUNDED: 'Refunded', CLOSED: 'Closed',
}

const listHtml = items => items.length
  ? `<ul style="margin:6px 0 14px;padding-left:20px">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
  : '<p style="margin:6px 0 14px;color:#64748B">None</p>'

const PENDING_DOC = ['PENDING', 'REJECTED', 'RESUBMISSION_REQUIRED', 'pending', 'rejected']
const SUBMITTED_DOC = ['UPLOADED', 'UNDER_REVIEW', 'APPROVED', 'uploaded', 'under-review', 'accepted']

async function buildVariables({ customerId, orderId, paymentId, invoiceId, ticketId, extra = {} }) {
  const v = {
    company_name: 'LauncherDesk',
    support_email: process.env.SUPPORT_EMAIL || 'contact@launcherdesk.com',
    dashboard_url: URLS.dashboard(),
    support_url: URLS.support(),
    verification_url: URLS.verify(),
  }

  const order = orderId ? await ServiceOrder.findById(orderId).lean() : null
  const custId = customerId || order?.user
  const customer = custId ? await User.findById(custId).lean() : null

  if (customer) Object.assign(v, {
    customer_name: customer.name?.split(' ')[0] || customer.name || 'there',
    customer_full_name: customer.name || '',
    customer_email: customer.email,
    customer_phone: customer.phone || '',
  })

  if (order) {
    const docs = await ServiceDocument.find({ order: order._id, type: { $ne: 'output' } }).lean()
    const outputs = await ServiceDocument.find({ order: order._id, type: 'output' }).lean()
    const pending = docs.filter(d => PENDING_DOC.includes(d.status)).map(d => d.name)
    const submitted = docs.filter(d => SUBMITTED_DOC.includes(d.status)).map(d => d.name)
    Object.assign(v, {
      order_id: order.orderNumber || String(order._id),
      order_url: URLS.order(order._id),
      document_upload_url: URLS.documents(order._id),
      documents_url: URLS.documents(order._id),
      feedback_url: URLS.feedback(order._id),
      action_url: order.actionRequired?.ctaUrl || URLS.order(order._id),
      service_name: order.serviceTitle,
      service_category: order.serviceCategory || '',
      order_date: date(order.createdAt),
      order_status: STATUS_LABELS[order.status] || order.status,
      taxable_amount: inr(order.baseAmount ?? order.professionalFee),
      gst_amount: inr(order.gstAmount),
      total_amount: inr(order.totalAmount),
      documents_pending: pending.join(', ') || 'None',
      documents_submitted: submitted.join(', ') || 'None',
      documents_pending_html: listHtml(pending),
      documents_submitted_html: listHtml(submitted),
      documents_submitted_count: String(submitted.length),
      final_documents_html: listHtml(outputs.map(d => d.name)),
      assigned_executive: order.assignedProfessional?.name ? `${order.assignedProfessional.name}${order.assignedProfessional.designation ? ` (${order.assignedProfessional.designation})` : ''}` : 'our operations team',
      hold_reason: order.holdReason || 'Pending documents or information',
      action_required: order.actionRequired?.what || '',
      action_reason: order.actionRequired?.why || '',
      action_steps: order.actionRequired?.how || '',
      action_deadline: order.actionRequired?.deadline ? date(order.actionRequired.deadline) : 'Not applicable',
      completion_date: date(order.completedAt || new Date()),
      cancellation_reason: order.cancellationReason || 'Not specified',
      current_stage: STATUS_LABELS[order.status] || order.status,
    })
  }

  const payment = paymentId ? await Payment.findById(paymentId).lean() : (order?.payment ? await Payment.findById(order.payment).lean() : null)
  if (payment) Object.assign(v, {
    payment_id: payment.razorpayPaymentId || payment.razorpayOrderId,
    payment_status: payment.status,
    payment_amount: inr(payment.amountRupees),
    payment_date: date(payment.verifiedAt || payment.updatedAt),
  })

  const invoice = invoiceId ? await Invoice.findById(invoiceId).lean() : null
  if (invoice) Object.assign(v, {
    invoice_number: invoice.invoiceNumber,
    invoice_date: date(invoice.invoiceDate),
    invoice_url: URLS.invoices(),
    taxable_amount: inr(invoice.taxableAmount),
    gst_amount: inr(invoice.gstAmount),
    total_amount: inr(invoice.totalAmount),
  })

  const ticket = ticketId ? await SupportTicket.findById(ticketId).lean() : null
  if (ticket) Object.assign(v, { ticket_id: ticket.ticketId, ticket_subject: ticket.subject, ticket_url: URLS.ticket(ticket.ticketId) })

  return { ...v, ...extra }
}

module.exports = { buildVariables, URLS, STATUS_LABELS, inr }
