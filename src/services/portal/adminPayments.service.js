const { Payment, Order, Client } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');

function escapeRegex(v) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function paise2rupees(paise) {
  if (!paise && paise !== 0) return null;
  return paise / 100;
}

function serializePayment(payment, order) {
  const o = order || payment.order;
  return {
    id: payment._id,
    paymentCode: payment.paymentCode ?? null,
    // order info
    orderId: o?._id ?? payment.order,
    orderCode: o?.orderCode ?? null,
    invoiceNumber: o?.invoiceNumber ?? null,
    // client info — always expose the ObjectId for navigation
    clientId: payment.client ?? null,
    clientName: o?.clientSnapshot?.name ?? null,
    clientCode: o?.clientSnapshot?.clientCode ?? null,
    clientEmail: o?.clientSnapshot?.email ?? null,
    // service info
    serviceName: o?.serviceSnapshot?.name ?? null,
    // pricing
    originalPriceRupees: paise2rupees(o?.pricing?.totalAmountMinor) ?? null,
    baseAmountRupees: paise2rupees(o?.pricing?.baseAmount ? o.pricing.baseAmount * 100 : null) ?? null,
    gstAmountRupees: o?.pricing?.gstAmount ?? null,
    gstApplicable: o?.pricing?.gstApplicable ?? false,
    netAmountRupees: paise2rupees(payment.amountPaise),
    refundAmountRupees: paise2rupees(payment.refundAmountPaise),
    // admin
    assignedAdminName: o?.assignedAdmin?.name ?? null,
    assignedAdminCode: o?.assignedAdmin?.adminCode ?? null,
    // payment
    provider: payment.provider,
    providerOrderId: payment.providerOrderId ?? null,
    providerPaymentId: payment.providerPaymentId ?? null,
    status: payment.status,
    method: payment.method ?? null,
    currency: payment.currency,
    signatureVerified: payment.signatureVerified,
    captured: payment.captured,
    failedAt: payment.failedAt ?? null,
    failureReason: payment.failureReason ?? null,
    paidAt: payment.paidAt ?? null,
    refundedAt: payment.refundedAt ?? null,
    attemptNumber: payment.attemptNumber,
    // order status
    orderPaymentStatus: o?.paymentStatus ?? null,
    orderStatus: o?.status ?? null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

async function listPayments({ page = 1, limit = 20, sortBy = 'createdAt', sortDir = 'desc', search, status, method, provider, dateFrom, dateTo, clientId } = {}) {
  // Build filter
  const filter = {};
  if (status) filter.status = status;
  if (method) filter.method = method;
  if (provider) filter.provider = provider;
  if (clientId) filter.client = clientId;
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  // Handle search against providerPaymentId / providerOrderId / paymentCode
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ paymentCode: re }, { legacyPaymentCode: re }, { legacyCode: re }, { providerPaymentId: re }, { providerOrderId: re }];
  }

  const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };
  const skip = (page - 1) * limit;

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate({
        path: 'order',
        select: 'orderCode invoiceNumber clientSnapshot serviceSnapshot pricing paymentStatus status assignedAdmin',
        populate: { path: 'assignedAdmin', select: 'name adminCode' },
      })
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Payment.countDocuments(filter),
  ]);

  return {
    items: payments.map((p) => serializePayment(p, p.order)),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    },
  };
}

async function getPaymentById(id) {
  const payment = await Payment.findById(id)
    .populate({
      path: 'order',
      select: 'orderCode invoiceNumber clientSnapshot serviceSnapshot pricing paymentStatus status assignedAdmin client',
      populate: { path: 'assignedAdmin', select: 'name adminCode email' },
    })
    .populate('client', 'name clientCode email phone companyName');

  if (!payment) throw AppError.notFound('Payment not found.');
  return serializePayment(payment, payment.order);
}

module.exports = { listPayments, getPaymentById, serializePayment };
