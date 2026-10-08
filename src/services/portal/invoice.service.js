const { Invoice, Order, Payment, Client } = require('../../models/portal');
const { generateInvoicePdfBuffer } = require('./invoicePdf.service');
const { uploadPrivateDocument, getPrivateDocument, deletePrivateDocument } = require('./documentStorage.service');
const { generateTaxInvoiceNumber } = require('./idGenerator.service');
const communicationService = require('./communication.service');
const notificationEventsService = require('./notificationEvents.service');
const { logAudit } = require('./auditLog.service');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { PAYMENT_ATTEMPT_STATUS } = require('../../constants/portal/paymentAttemptStatus');
const AppError = require('../../utils/portal/AppError');
const logger = require('../../utils/portal/logger');

const SELLER_NAME = 'LAUNCHERDESK';
const PAYEE_NAME = 'DUTYLAUNCH SOLUTIONS PVT. LTD.';

function formatInvoiceDate(d) {
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${dt.getFullYear()}`;
}

/** Builds the exact { items, gst, totals, grandTotalMinor } shape invoicePdf.service.js expects, from one order + its confirmed payment. */
function buildPdfData({ order, payment, client, invoiceNumber }) {
  const gstPercentage = order.serviceSnapshot.gstApplicable ? order.serviceSnapshot.gstPercentage : 0;
  const baseMinor = order.pricing.baseAmountMinor;
  const gstMinor = order.pricing.gstAmountMinor;
  const totalMinor = order.pricing.totalAmountMinor;
  const halfGstMinor = Math.round(gstMinor / 2);

  const items = [
    {
      sac: '998213',
      description: order.serviceSnapshot.name,
      qty: 1,
      grossMinor: baseMinor,
      discountMinor: 0,
      taxableMinor: baseMinor,
      sgstMinor: 0,
      cgstMinor: 0,
      totalMinor: baseMinor,
    },
  ];

  return {
    invoiceNumber,
    invoiceDate: formatInvoiceDate(payment.paidAt || new Date()),
    sellerName: SELLER_NAME,
    payeeName: PAYEE_NAME,
    customerName: client.companyName || client.name,
    totalItems: 1,
    items,
    gst: {
      gstPercentage,
      taxableMinor: baseMinor,
      sgstMinor: halfGstMinor,
      cgstMinor: gstMinor - halfGstMinor,
      gstTotalMinor: gstMinor,
    },
    totals: {
      totalItems: 1,
      grossMinor: baseMinor,
      discountMinor: 0,
      taxableMinor: baseMinor,
      sgstMinor: halfGstMinor,
      cgstMinor: gstMinor - halfGstMinor,
      totalMinor,
    },
    grandTotalMinor: totalMinor,
    thankYou: null,
    terms: null,
  };
}

/**
 * The ONE entry point for turning a successful payment into a stored,
 * emailed tax invoice. Idempotent via the unique index on Invoice.payment -
 * calling this twice for the same payment returns the existing invoice,
 * never generates or emails a second one. Never throws into the caller
 * (orderStateMachine.service.js) - a PDF/email failure must never roll back
 * the payment-confirmation transition that triggered it.
 */
async function generateAndSendInvoiceForPayment(order, payment) {
  try {
    if (payment.status !== PAYMENT_ATTEMPT_STATUS.CONFIRMED) {
      // Only ever generate for a genuinely successful payment - never
      // FAILED/CANCELLED/REFUNDED/PENDING, per the brief.
      return null;
    }

    const existing = await Invoice.findOne({ payment: payment._id, isCurrentVersion: true });
    if (existing) return existing;

    const client = await Client.findById(order.client);
    if (!client) {
      logger.error(`[invoice] Cannot generate invoice for order ${order.orderCode}: client ${order.client} not found.`);
      return null;
    }

    const invoiceNumber = await generateTaxInvoiceNumber();
    const pdfData = buildPdfData({ order, payment, client, invoiceNumber });
    const buffer = await generateInvoicePdfBuffer(pdfData);

    const originalFileName = `${invoiceNumber.replace(/\//g, '-')}.pdf`;
    const { storageKey, storageProvider, checksum, sizeBytes } = await uploadPrivateDocument({
      buffer,
      originalFileName,
      keyPrefix: `invoices/${order._id}`,
    });

    const invoice = await Invoice.create({
      invoiceNumber,
      order: order._id,
      payment: payment._id,
      client: client._id,
      billingSnapshot: {
        customerName: client.companyName || client.name,
        customerEmail: client.email,
        customerPhone: client.phone || null,
        billingAddress: client.address || null,
        gstNumber: client.gst?.number || null,
        serviceName: order.serviceSnapshot.name,
        serviceCategory: order.serviceSnapshot.category,
        quantity: 1,
        unitPriceMinor: order.pricing.baseAmountMinor,
        discountMinor: 0,
        gstPercentage: pdfData.gst.gstPercentage,
        gstAmountMinor: order.pricing.gstAmountMinor,
        totalAmountMinor: order.pricing.totalAmountMinor,
        currency: order.pricing.currency,
        paymentMethod: payment.method || null,
        transactionId: payment.providerPaymentId || null,
        orderCode: order.orderCode,
        paymentCode: payment.paymentCode || null,
        paidAt: payment.paidAt || null,
      },
      originalFileName,
      sizeBytes,
      checksum,
      storageProvider,
      storageKey,
      generatedBy: 'SYSTEM',
    });

    await logAudit({
      actor: null,
      actorRole: 'SYSTEM',
      action: AUDIT_ACTIONS.INVOICE_GENERATED,
      resourceType: 'Order',
      resourceId: order._id,
      metadata: { invoiceNumber, paymentId: String(payment._id), checksum, sizeBytes },
    });

    communicationService.sendInvoiceGenerated(order, invoice).catch((err) => {
      logger.error(`[invoice] sendInvoiceGenerated failed for ${invoiceNumber}: ${err.message}`);
    });

    return invoice;
  } catch (err) {
    logger.error(`[invoice] generateAndSendInvoiceForPayment failed for order ${order?.orderCode}: ${err.message}`);
    notificationEventsService
      .notifyInvoiceFailed(order, err)
      .catch((notifyErr) => logger.error(`[invoice] notifyInvoiceFailed failed: ${notifyErr.message}`));
    return null;
  }
}

/**
 * Real, live email delivery status for an invoice comes from CommunicationLog
 * (the actual outbox - see communication.service.js), NOT from
 * Invoice.emailStatus/emailSentAt, which this system never actually writes
 * to after creation (sendInvoiceGenerated() is deliberately fire-and-forget
 * so a slow/failed email can never block invoice generation - there was
 * never a second write-back step). Rather than ship a frontend reading a
 * field that is always stuck at its default, this looks up the real log
 * record. Only QUEUED/SENDING/SENT/RETRYING/FAILED/CANCELLED are ever
 * actually possible - this system has no Brevo delivery webhook, so
 * DELIVERED/BOUNCED/OPENED/CLICKED (schema-valid in principle) never
 * actually occur and are never returned here.
 */
async function attachEmailDelivery(invoices) {
  const { CommunicationLog } = require('../../models/portal');
  const orderIds = invoices.map((i) => i.order);
  const logs = await CommunicationLog.find({ order: { $in: orderIds }, eventType: 'INVOICE_GENERATED', channel: 'EMAIL' })
    .sort({ createdAt: -1 })
    .select('order status sentAt attemptCount failureReason to createdAt')
    .lean();
  const latestByOrder = new Map();
  for (const log of logs) {
    const key = String(log.order);
    if (!latestByOrder.has(key)) latestByOrder.set(key, log); // already sorted newest-first
  }
  return invoices.map((invoice) => {
    const log = latestByOrder.get(String(invoice.order));
    return {
      ...serializeInvoice(invoice),
      emailDelivery: log
        ? { status: log.status, sentAt: log.sentAt, attemptCount: log.attemptCount, failureReason: log.failureReason, recipient: log.to }
        : { status: 'NOT_SENT', sentAt: null, attemptCount: 0, failureReason: null, recipient: null },
    };
  });
}

function serializeInvoice(invoice) {
  return {
    id: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    order: invoice.order,
    client: invoice.client,
    billingSnapshot: invoice.billingSnapshot,
    originalFileName: invoice.originalFileName,
    sizeBytes: invoice.sizeBytes,
    checksum: invoice.checksum,
    storageProvider: invoice.storageProvider, // 'local' or 's3' only - the raw storageKey itself stays internal (select:false on the model), never exposed
    status: invoice.status,
    generatedAt: invoice.generatedAt,
    generatedBy: invoice.generatedBy,
    version: invoice.version,
    createdAt: invoice.createdAt,
  };
}

async function listInvoicesForClient(clientId, { page = 1, limit = 20 } = {}) {
  const filter = { client: clientId, isCurrentVersion: true };
  const [items, total] = await Promise.all([
    Invoice.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Invoice.countDocuments(filter),
  ]);
  return { items: await attachEmailDelivery(items), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

async function listInvoicesForAdmin({ page = 1, limit = 20, search } = {}) {
  const filter = { isCurrentVersion: true };
  if (search) {
    const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { invoiceNumber: re },
      { 'billingSnapshot.orderCode': re },
      { 'billingSnapshot.customerName': re },
      { 'billingSnapshot.customerEmail': re },
      { 'billingSnapshot.gstNumber': re },
      { 'billingSnapshot.serviceName': re },
    ];
  }
  const [items, total] = await Promise.all([
    Invoice.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Invoice.countDocuments(filter),
  ]);
  return { items: await attachEmailDelivery(items), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

/** Order Details / Payments page lookup: the current invoice for an order, or null if none exists yet. */
async function getInvoiceByOrder(orderId) {
  const invoice = await Invoice.findOne({ order: orderId, isCurrentVersion: true });
  if (!invoice) return null;
  const [withDelivery] = await attachEmailDelivery([invoice]);
  return withDelivery;
}

/** Super Admin "Version History": every version ever generated for an order, newest first, including superseded ones. */
async function listInvoiceVersions(orderId) {
  const items = await Invoice.find({ order: orderId }).sort({ version: -1 });
  return items.map(serializeInvoice);
}

async function getInvoiceFile(invoiceId, actor) {
  const invoice = await Invoice.findById(invoiceId).select('+storageKey');
  if (!invoice) throw AppError.notFound('Invoice not found.');
  const buffer = await getPrivateDocument(invoice.storageKey);

  // Part 3 gap: every invoice download/preview is now audit-logged (brief
  // requires download/preview/resend to all be logged); never blocks the
  // actual file response if logging itself fails.
  logAudit({
    actor: actor?._id || null,
    actorRole: actor?.role || 'SYSTEM',
    action: AUDIT_ACTIONS.INVOICE_DOWNLOADED,
    resourceType: 'Order',
    resourceId: invoice.order,
    metadata: { invoiceNumber: invoice.invoiceNumber, invoiceId: String(invoice._id) },
  }).catch((err) => logger.error(`[invoice] audit log for download failed: ${err.message}`));

  return { buffer, filename: invoice.originalFileName };
}

/** Admin/Super Admin action: re-send the (already generated) invoice email without regenerating the PDF. */
async function resendInvoiceEmail(invoiceId, actor) {
  const invoice = await Invoice.findById(invoiceId).select('+storageKey');
  if (!invoice) throw AppError.notFound('Invoice not found.');
  const order = await Order.findById(invoice.order);
  if (!order) throw AppError.notFound('Order not found.');

  await communicationService.sendInvoiceGenerated(order, invoice, { resend: true });
  await logAudit({
    actor: actor._id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.INVOICE_EMAIL_RESENT,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { invoiceNumber: invoice.invoiceNumber },
  });
  return invoice;
}

/** Super Admin only: produces a brand-new PDF (e.g. after a data correction) and supersedes the old version - never overwrites it, mirroring KycDocument.model.js's versioning discipline. */
async function regenerateInvoice(invoiceId, actor) {
  const previous = await Invoice.findById(invoiceId).select('+storageKey');
  if (!previous) throw AppError.notFound('Invoice not found.');
  const order = await Order.findById(previous.order);
  const payment = await Payment.findById(previous.payment);
  const client = await Client.findById(previous.client);
  if (!order || !payment || !client) throw AppError.notFound('Underlying order/payment/client no longer exists.');

  const pdfData = buildPdfData({ order, payment, client, invoiceNumber: previous.invoiceNumber });
  const buffer = await generateInvoicePdfBuffer(pdfData);
  const { storageKey, storageProvider, checksum, sizeBytes } = await uploadPrivateDocument({
    buffer,
    originalFileName: previous.originalFileName,
    keyPrefix: `invoices/${order._id}`,
  });

  previous.isCurrentVersion = false;
  await previous.save();

  const next = await Invoice.create({
    invoiceNumber: `${previous.invoiceNumber}-R${previous.version + 1}`,
    order: order._id,
    payment: payment._id,
    client: client._id,
    billingSnapshot: previous.billingSnapshot,
    originalFileName: previous.originalFileName,
    sizeBytes,
    checksum,
    storageProvider,
    storageKey,
    generatedBy: String(actor._id),
    version: previous.version + 1,
  });

  await logAudit({
    actor: actor._id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.INVOICE_REGENERATED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { previousInvoiceNumber: previous.invoiceNumber, newInvoiceNumber: next.invoiceNumber },
  });

  return next;
}

/** Super Admin only: deletes the stored PDF and the metadata record. */
async function deleteInvoice(invoiceId, actor) {
  const invoice = await Invoice.findById(invoiceId).select('+storageKey');
  if (!invoice) throw AppError.notFound('Invoice not found.');

  await deletePrivateDocument(invoice.storageKey).catch(() => {});
  await Invoice.deleteOne({ _id: invoice._id });

  await logAudit({
    actor: actor._id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.INVOICE_DELETED,
    resourceType: 'Order',
    resourceId: invoice.order,
    metadata: { invoiceNumber: invoice.invoiceNumber },
  });
}

module.exports = {
  generateAndSendInvoiceForPayment,
  listInvoicesForClient,
  listInvoicesForAdmin,
  listInvoiceVersions,
  getInvoiceByOrder,
  getInvoiceFile,
  resendInvoiceEmail,
  regenerateInvoice,
  deleteInvoice,
  serializeInvoice,
};
