/**
 * Tax invoices — generated ONLY after a confirmed payment (called from
 * paymentService.markPaid), one per payment (unique index on `payment`).
 * The PDF is built on demand and only served through an authenticated route.
 *
 * GST mode (env INVOICE_GST_MODE):
 *   'inclusive' (default) — the amount charged already includes 18% GST
 *   'exclusive'           — GST is added on top of the order amount
 *     (only use this if the checkout actually charges amount + GST)
 */
const Invoice = require('../models/Invoice')
const Counter = require('../models/Counter')
const User = require('../models/User')

const GST_RATE = Number(process.env.INVOICE_GST_RATE || 18)
const round2 = n => Math.round(n * 100) / 100

function financialYear(d = new Date()) {
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const y = ist.getFullYear(), start = ist.getMonth() >= 3 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

function splitGst(amountPaid) {
  if ((process.env.INVOICE_GST_MODE || 'inclusive') === 'exclusive') {
    const gst = round2(amountPaid * GST_RATE / 100)
    return { taxable: round2(amountPaid), gst, total: round2(amountPaid + gst) }
  }
  const taxable = round2(amountPaid / (1 + GST_RATE / 100))
  return { taxable, gst: round2(amountPaid - taxable), total: round2(amountPaid) }
}

/**
 * Orders created at checkout save the exact split (professional fee, GST, government
 * fee). Use it so GST is only ever calculated on the professional fee — never on a
 * pass-through government fee. Older payments fall back to splitGst().
 */
function splitForInvoice(payment) {
  const bd = payment.breakdown
  if (bd && bd.feePaise > 0 && bd.gstPaise >= 0) {
    const taxable = round2(bd.feePaise / 100)
    const gst = round2(bd.gstPaise / 100)
    const govt = bd.govtCollected ? round2((bd.govtPaise || 0) / 100) : 0
    const total = round2(payment.amountRupees)
    if (Math.abs(taxable + gst + govt - total) < 0.011) return { taxable, gst, govt, total }
  }
  return { ...splitGst(payment.amountRupees), govt: 0 }
}

async function createInvoice(order, payment) {
  const existing = await Invoice.findOne({ payment: payment._id })
  if (existing) return { invoice: existing, created: false }
  const fy = financialYear()
  const seq = await Counter.next(`invoice-${fy}`)
  const customer = await User.findById(order.user).lean()
  const { taxable, gst, total, govt } = splitForInvoice(payment)
  try {
    const invoice = await Invoice.create({
      invoiceNumber: `LD/${fy}/${String(seq).padStart(6, '0')}`,
      order: order._id, payment: payment._id, customer: order.user,
      customerName: customer?.name, customerEmail: customer?.email, customerPhone: customer?.phone,
      serviceName: order.serviceTitle, taxableAmount: taxable, gstRate: GST_RATE, gstAmount: gst, govtFeeAmount: govt, totalAmount: total,
      paymentReference: payment.razorpayPaymentId,
    })
    return { invoice, created: true }
  } catch (err) {
    if (err.code === 11000) return { invoice: await Invoice.findOne({ payment: payment._id }), created: false }
    throw err
  }
}

/** Render an invoice to a PDF Buffer (requires the `pdfkit` package). */
function invoicePdf(inv) {
  const PDFDocument = require('pdfkit')
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks = []
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject)
    const money = n => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const d = new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

    doc.fontSize(20).fillColor('#0A2540').text('LauncherDesk', 50, 50)
    doc.fontSize(9).fillColor('#475569')
      .text(process.env.COMPANY_LEGAL_NAME || 'LauncherDesk Solutions Private Limited')
      .text(process.env.COMPANY_ADDRESS || '472/7, 20th L Cross Rd, Koramangala, Bengaluru 560095')
      .text(process.env.COMPANY_GSTIN ? `GSTIN: ${process.env.COMPANY_GSTIN}` : 'GSTIN: —')
    doc.fontSize(16).fillColor('#0A2540').text('TAX INVOICE', 350, 50, { align: 'right' })
    doc.fontSize(10).fillColor('#334155').text(`Invoice No: ${inv.invoiceNumber}`, 350, 75, { align: 'right' }).text(`Date: ${d}`, { align: 'right' })

    doc.moveDown(3).fontSize(11).fillColor('#0A2540').text('Bill To', 50, 150)
    doc.fontSize(10).fillColor('#334155').text(inv.customerName || '').text(inv.customerEmail || '').text(inv.customerPhone || '')

    const top = 230
    doc.rect(50, top, 495, 24).fill('#F1F5F9')
    doc.fillColor('#0A2540').fontSize(10).text('Description', 60, top + 7).text('Amount', 430, top + 7, { width: 105, align: 'right' })
    doc.fillColor('#334155')
      .text(inv.serviceName || 'Professional services', 60, top + 36, { width: 340 })
      .text(money(inv.taxableAmount), 430, top + 36, { width: 105, align: 'right' })
    let y = top + 76
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#E2E8F0').stroke()
    const row = (label, val, bold) => { y += 18; doc.fontSize(bold ? 11 : 10).fillColor(bold ? '#0A2540' : '#334155').text(label, 300, y, { width: 130, align: 'right' }).text(val, 430, y, { width: 105, align: 'right' }) }
    row('Taxable amount', money(inv.taxableAmount))
    row(`GST @ ${inv.gstRate}%`, money(inv.gstAmount))
    if (inv.govtFeeAmount > 0) row('Govt. fee (at actual)', money(inv.govtFeeAmount))
    row('Total', money(inv.totalAmount), true)
    doc.fontSize(9).fillColor('#64748B').text(`Payment reference: ${inv.paymentReference || '—'}`, 50, y + 40)
      .text('This is a computer-generated invoice and does not require a signature.', 50, y + 56)
    doc.end()
  })
}

module.exports = { createInvoice, invoicePdf, splitGst, splitForInvoice }