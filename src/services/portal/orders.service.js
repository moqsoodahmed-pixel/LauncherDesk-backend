const mongoose = require('mongoose');
const { Order, Client, Service, OrderStatusHistory, AuditLog, Payment } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { ORDER_STATUS, ORDER_STATUS_LABELS, CLIENT_CANCELLABLE_STATUSES } = require('../../constants/portal/orderStatus');
const { ORDER_PAYMENT_STATUS, isValidPaymentStatusTransition } = require('../../constants/portal/orderPaymentStatus');
const { SERVICE_STATUS } = require('../../constants/portal/serviceStatus');
const { CLIENT_STATUS } = require('../../constants/portal/clientStatus');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { computePricingSummary, paiseToRupees } = require('./money.service');
const { validateOrderDetails } = require('./orderFormValidation.service');
const { nextOrderCode } = require('./orderSequence.service');
const { generateInvoiceNumber, generatePaymentCode } = require('./idGenerator.service');
const { transitionOrderStatus } = require('./orderStateMachine.service');
const { isOrderEligibleForClosure } = require('./kycDeletion.service');
const { logAudit } = require('./auditLog.service');
const communicationService = require('./communication.service');
const notificationEventsService = require('./notificationEvents.service');

function auditCtx(actor) {
  return { actor: actor._id, actorRole: actor.role };
}

// Adds convenient major-unit (rupee) fields alongside the immutable minor-unit
// (paise) snapshot - display only, never recomputed from the live Service.
function pricingWithDisplayFields(pricing) {
  // `pricing` is a Mongoose subdocument, not a plain object - spreading it
  // directly (`{ ...pricing }`) copies Mongoose's own internal bookkeeping
  // properties ($__, $__parent, _doc, ...) along with the real fields,
  // leaking them straight into the API response. Whitelist explicitly
  // instead of spreading.
  return {
    currency: pricing.currency,
    baseAmountMinor: pricing.baseAmountMinor,
    gstApplicable: pricing.gstApplicable,
    gstPercentage: pricing.gstPercentage,
    gstAmountMinor: pricing.gstAmountMinor,
    totalAmountMinor: pricing.totalAmountMinor,
    baseAmount: paiseToRupees(pricing.baseAmountMinor),
    gstAmount: paiseToRupees(pricing.gstAmountMinor),
    total: paiseToRupees(pricing.totalAmountMinor),
  };
}

/** Full shape for internal (Super Admin / permitted Admin) consumers. */
function serializeOrder(order) {
  return {
    id: order._id,
    orderCode: order.orderCode,
    invoiceNumber: order.invoiceNumber ?? null,
    client: order.client,
    service: order.service,
    clientSnapshot: order.clientSnapshot,
    serviceSnapshot: order.serviceSnapshot,
    orderDetails: order.orderDetails || {},
    pricing: pricingWithDisplayFields(order.pricing),
    status: order.status,
    paymentStatus: order.paymentStatus,
    assignedAdmin: order.assignedAdmin
      ? { id: order.assignedAdmin._id, name: order.assignedAdmin.name, adminCode: order.assignedAdmin.adminCode ?? null }
      : null,
    assignedAt: order.assignedAt ?? null,
    source: order.source,
    notes: order.notes || '',
    priority: order.priority || 'MEDIUM',
    slaDeadline: order.slaDeadline ?? null,
    slaStatus: order.slaStatus ?? null,
    cancellationReason: order.cancellationReason ?? null,
    cancelledAt: order.cancelledAt ?? null,
    completedAt: order.completedAt ?? null,
    closedAt: order.closedAt ?? null,
    createdBy: order.createdBy ?? null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Client-facing shape: never exposes internal staff notes or which Admin
 * is internally assigned - a Client only needs to know what they ordered,
 * what it costs, and what status it is in.
 */
function serializeOrderForClient(order) {
  return {
    id: order._id,
    orderCode: order.orderCode,
    invoiceNumber: order.invoiceNumber ?? null,
    serviceSnapshot: order.serviceSnapshot,
    orderDetails: order.orderDetails || {},
    pricing: pricingWithDisplayFields(order.pricing),
    status: order.status,
    paymentStatus: order.paymentStatus,
    cancellationReason: order.cancellationReason ?? null,
    completedAt: order.completedAt ?? null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every value here is already validated/allowlisted by
 * validators/orders.validators.js before reaching this function - no raw
 * query-string value is ever interpolated into the Mongo filter as-is,
 * and nothing here accepts an arbitrary operator object from the caller.
 */
function buildListFilter({ search, status, paymentStatus, client, service, assignedAdmin, source, category, dateFrom, dateTo }) {
  const filter = {};
  if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (client) filter.client = client;
  if (service) filter.service = service;
  if (assignedAdmin) filter.assignedAdmin = assignedAdmin;
  if (source) filter.source = source;
  if (category) filter['serviceSnapshot.category'] = category;
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [
      { orderCode: re },
      { legacyOrderCode: re },
      { legacyCode: re },
      { invoiceNumber: re },
      { legacyInvoiceNumber: re },
      { 'clientSnapshot.name': re },
      { 'clientSnapshot.email': re },
      { 'serviceSnapshot.name': re },
    ];
  }
  return filter;
}

async function listOrders(scopeFilter, filters, { page = 1, limit = 20, sortBy = 'createdAt', sortDir = 'desc' } = {}) {
  const filter = { $and: [scopeFilter, buildListFilter(filters)] };
  const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };

  const [items, total] = await Promise.all([
    Order.find(filter)
      .populate('assignedAdmin', 'name email adminCode')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    Order.countDocuments(filter),
  ]);

  return {
    items,
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

/**
 * The ONE place an order is ever created - both POST /api/orders
 * (internal) and POST /api/client/orders call this with a different
 * `clientId` source, never duplicating the business logic.
 *
 * `clientId` is resolved by the caller (the authenticated Client's own
 * `clientProfile` for a client-created order, or an internal user's
 * chosen client for an internal order) - this function always trusts
 * that resolved id, never anything else from the request body.
 */
async function createOrder({ clientId, serviceId, orderDetails, notes, source, actor, meta = {} }) {
  if (!mongoose.isValidObjectId(clientId) || !mongoose.isValidObjectId(serviceId)) {
    throw AppError.badRequest('A valid client and service are required.');
  }

  const [client, service] = await Promise.all([Client.findById(clientId), Service.findById(serviceId)]);

  if (!client) throw AppError.badRequest('Client not found.');
  if (client.status === CLIENT_STATUS.ARCHIVED) throw AppError.badRequest('This client is archived and cannot place new orders.');

  if (!service) throw AppError.badRequest('Service not found.');
  if (service.status !== SERVICE_STATUS.ACTIVE) {
    throw AppError.badRequest('This service is not currently available for new orders.');
  }
  if (source === 'CLIENT' && !service.isPublic) {
    throw AppError.badRequest('This service is not available for self-service ordering.');
  }

  // Validates AND strips anything not defined in the service's formSchema -
  // the only orderDetails that can ever reach storage are fields the
  // Service itself declared, each type/shape-checked.
  const cleanedDetails = validateOrderDetails(service.formSchema, orderDetails);

  // Server computes every commercial figure - never trusts a
  // client-submitted price/GST/total (see money.service.js).
  const pricingSummary = computePricingSummary({
    basePriceMinor: service.basePriceMinor,
    gstApplicable: service.gstApplicable,
    gstPercentage: service.gstPercentage,
    currency: service.currency,
  });

  const serviceSnapshot = {
    serviceCode: service.serviceCode,
    name: service.name,
    slug: service.slug,
    category: service.category,
    basePriceMinor: service.basePriceMinor,
    currency: service.currency,
    gstApplicable: service.gstApplicable,
    gstPercentage: service.gstPercentage,
    requiresKyc: service.requiresKyc,
    requiresClientDetails: service.requiresClientDetails,
    requiredDocuments: (service.requiredDocuments || []).map((d) => ({
      documentType: d.documentType,
      label: d.label,
      mandatory: d.mandatory,
    })),
  };

  const clientSnapshot = {
    clientCode: client.clientCode,
    name: client.name,
    companyName: client.companyName || null,
    email: client.email,
    phone: client.phone || null,
  };

  const pricing = {
    currency: pricingSummary.currency,
    baseAmountMinor: pricingSummary.basePriceMinor,
    gstApplicable: service.gstApplicable,
    gstPercentage: service.gstPercentage,
    gstAmountMinor: pricingSummary.gstAmountMinor,
    totalAmountMinor: pricingSummary.totalMinor,
  };

  const paymentStatus = pricing.totalAmountMinor > 0 ? ORDER_PAYMENT_STATUS.PENDING : ORDER_PAYMENT_STATUS.NOT_REQUIRED;

  let order;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const orderCode = await nextOrderCode();
      const invoiceNumber = await generateInvoiceNumber();
      const [createdOrder] = await Order.create(
        [
          {
            orderCode,
            invoiceNumber,
            client: client._id,
            service: service._id,
            serviceSnapshot,
            clientSnapshot,
            orderDetails: cleanedDetails,
            pricing,
            status: ORDER_STATUS.CREATED,
            paymentStatus,
            source,
            notes: notes || '',
            createdBy: actor?._id || null,
            updatedBy: actor?._id || null,
          },
        ],
        { session }
      );
      await OrderStatusHistory.create([{ order: createdOrder._id, fromStatus: null, toStatus: ORDER_STATUS.CREATED, changedBy: actor?._id || null }], {
        session,
      });
      order = createdOrder;
    });
  } catch (err) {
    // Also matches MongoDB-compatible servers without transaction support (e.g. FerretDB).
    if (!/Transaction numbers|replica set|autocommit|transactions? (are )?not supported/i.test(err.message || '')) {
      throw err;
    }
    // Standalone dev mongod fallback - sequential create with manual
    // rollback of the Order if the history write fails, consistent with
    // clients.service.createClient()'s same fallback.
    const orderCode = await nextOrderCode();
    const invoiceNumber = await generateInvoiceNumber();
    order = await Order.create({
      orderCode,
      invoiceNumber,
      client: client._id,
      service: service._id,
      serviceSnapshot,
      clientSnapshot,
      orderDetails: cleanedDetails,
      pricing,
      status: ORDER_STATUS.CREATED,
      paymentStatus,
      source,
      notes: notes || '',
      createdBy: actor?._id || null,
      updatedBy: actor?._id || null,
    });
    try {
      await OrderStatusHistory.create({ order: order._id, fromStatus: null, toStatus: ORDER_STATUS.CREATED, changedBy: actor?._id || null });
    } catch (historyErr) {
      await Order.deleteOne({ _id: order._id });
      throw historyErr;
    }
  } finally {
    await session.endSession();
  }

  await logAudit({
    actor: actor?._id || null,
    actorRole: actor?.role || 'SYSTEM',
    action: AUDIT_ACTIONS.ORDER_CREATED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { orderCode: order.orderCode, clientId: String(client._id), serviceId: String(service._id), source },
    ...meta,
  });

  // Fire-and-forget: communication.service.js never throws, so this can
  // never fail order creation - see its own doc-comment.
  await communicationService.sendOrderCreated(order).catch(() => {});
  await notificationEventsService.notifyOrderCreated(order, actor?._id).catch(() => {});

  // Immediately advance CREATED -> PAYMENT_PENDING when a payment is
  // expected, through the single state-machine service so the hop is
  // still properly historied/audited rather than special-cased here.
  if (paymentStatus === ORDER_PAYMENT_STATUS.PENDING) {
    order = await transitionOrderStatus({
      orderId: order._id,
      toStatus: ORDER_STATUS.PAYMENT_PENDING,
      changedBy: actor?._id || null,
      reason: 'Payment required for this order.',
    });
  }

  return order;
}

const UPDATABLE_FIELDS = ['notes', 'priority', 'slaDeadline'];

async function updateOrder(order, changes, actor, meta = {}) {
  const applied = {};
  for (const field of UPDATABLE_FIELDS) {
    if (changes[field] !== undefined) {
      order[field] = changes[field];
      applied[field] = true;
    }
  }
  order.updatedBy = actor._id;
  await order.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ORDER_UPDATED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { fields: Object.keys(applied) },
    ...meta,
  });

  return order;
}

async function updateOrderStatus(order, status, actor, { reason, ...meta } = {}) {
  return transitionOrderStatus({ orderId: order._id, toStatus: status, changedBy: actor._id, reason });
}

async function cancelOrder(order, reason, actor, meta = {}) {
  const updated = await transitionOrderStatus({ orderId: order._id, toStatus: ORDER_STATUS.CANCELLED, changedBy: actor._id, reason });
  updated.cancellationReason = reason;
  updated.cancelledBy = actor._id;
  updated.cancelledAt = new Date();
  updated.updatedBy = actor._id;
  await updated.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ORDER_CANCELLED,
    resourceType: 'Order',
    resourceId: updated._id,
    metadata: { reason },
    ...meta,
  });

  return updated;
}

async function closeOrder(order, actor, meta = {}) {
  // For a KYC-requiring order, CLOSED is only reachable once every
  // document has genuinely been deleted (services/kycDeletion.service.js)
  // - never faked as a side effect of this call.
  if (!(await isOrderEligibleForClosure(order))) {
    throw AppError.badRequest('This order still has undeleted KYC documents and cannot be closed yet.');
  }

  const updated = await transitionOrderStatus({ orderId: order._id, toStatus: ORDER_STATUS.CLOSED, changedBy: actor._id });

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ORDER_CLOSED,
    resourceType: 'Order',
    resourceId: updated._id,
    ...meta,
  });

  return updated;
}

/**
 * Development/testing ONLY (see routes/orders.routes.js - disabled in
 * production). KYC document upload/deletion (Phase 7) does not exist yet,
 * so there is no real way to reach KYC_DELETION_PENDING/CLOSED through
 * the normal flow. This lets a Super Admin manually walk a test order
 * through those states WITHOUT pretending any KYC deletion actually
 * happened - every use is audited as ORDER_DEV_STATUS_OVERRIDE, distinct
 * from a normal ORDER_STATUS_CHANGED event, so it is never mistaken for
 * real workflow progress in the audit trail.
 */
async function devAdvanceStatus(order, toStatus, actor, meta = {}) {
  // Phase 7 made real KYC deletion exist - the dev-only override must not
  // become a silent backdoor around it. Reaching CLOSED still requires
  // every document to be genuinely deleted first; only the
  // COMPLETED -> KYC_DELETION_PENDING hop (for which no real automatic
  // trigger exists yet) remains purely a dev convenience.
  if (toStatus === ORDER_STATUS.CLOSED && !(await isOrderEligibleForClosure(order))) {
    throw AppError.badRequest('This order still has undeleted KYC documents and cannot be closed yet.');
  }

  const updated = await transitionOrderStatus({
    orderId: order._id,
    toStatus,
    changedBy: actor._id,
    reason: 'DEVELOPMENT-ONLY manual override (no real KYC deletion occurred).',
  });

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ORDER_DEV_STATUS_OVERRIDE,
    resourceType: 'Order',
    resourceId: updated._id,
    metadata: { toStatus, devOnly: true },
    ...meta,
  });

  return updated;
}

async function updatePaymentStatus(order, paymentStatus, actor, { reason, ...meta } = {}) {
  if (!isValidPaymentStatusTransition(order.paymentStatus, paymentStatus)) {
    throw AppError.invalidStateTransition(`Cannot move payment status from ${order.paymentStatus} to ${paymentStatus}.`);
  }

  const previous = order.paymentStatus;
  order.paymentStatus = paymentStatus;
  order.updatedBy = actor._id;
  await order.save();

  // When manually marking PAID (dev/testing), create a CONFIRMED Payment record
  // so that revenue dashboards reflect the payment correctly.
  if (paymentStatus === ORDER_PAYMENT_STATUS.PAID) {
    const existing = await Payment.findOne({ order: order._id, status: 'CONFIRMED' });
    if (!existing) {
      const paymentCode = await generatePaymentCode();
      await Payment.create({
        order: order._id,
        client: order.client,
        paymentCode,
        provider: 'DEVELOPMENT',
        amountPaise: order.pricing?.totalAmountMinor || 0,
        currency: 'INR',
        status: 'CONFIRMED',
        signatureVerified: false,
        captured: true,
        paidAt: new Date(),
        attemptNumber: 1,
        idempotencyKey: `dev-manual-${order._id}-${Date.now()}`,
      });
    }
  }

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ORDER_PAYMENT_STATUS_CHANGED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { from: previous, to: paymentStatus, reason: reason || null, devOnly: true },
    ...meta,
  });

  return order;
}

async function getOrderStatusHistory(orderId, { page = 1, limit = 50 } = {}) {
  const filter = { order: orderId };
  const [items, total] = await Promise.all([
    OrderStatusHistory.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    OrderStatusHistory.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

/**
 * Client-safe status history (Phase 6): only { status, label, createdAt } -
 * never the raw OrderStatusHistory document, which carries `changedBy`
 * (an internal staff user id) and a `reason` that may be an internal-only
 * note. A Client sees what happened and when, never who on staff did it
 * or why in operational terms.
 */
async function getClientOrderStatusHistory(orderId) {
  const items = await OrderStatusHistory.find({ order: orderId }).sort({ createdAt: 1 });
  return items.map((entry) => ({
    status: entry.toStatus,
    label: ORDER_STATUS_LABELS[entry.toStatus] || entry.toStatus,
    createdAt: entry.createdAt,
  }));
}

/**
 * Client-initiated cancellation. Deliberately narrower than the internal
 * CANCEL_ORDER-gated endpoint: only allowed while the order is still in
 * CLIENT_CANCELLABLE_STATUSES (see constants/orderStatus.js) - before any
 * Admin has actually started work on it. Reuses the same cancelOrder()
 * (and therefore the same orderStateMachine transition + audit trail) as
 * the internal path - not a second cancellation implementation.
 */
async function cancelOwnOrder(order, reason, actor, meta = {}) {
  if (!CLIENT_CANCELLABLE_STATUSES.includes(order.status)) {
    throw AppError.invalidStateTransition(
      `This order can no longer be self-cancelled (current status: ${order.status}). Contact support for assistance.`
    );
  }
  return cancelOrder(order, reason, actor, meta);
}

async function getOrderActivity(orderId, { page = 1, limit = 20 } = {}) {
  const filter = { resourceType: 'Order', resourceId: orderId };
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

module.exports = {
  serializeOrder,
  serializeOrderForClient,
  listOrders,
  createOrder,
  updateOrder,
  updateOrderStatus,
  cancelOrder,
  closeOrder,
  devAdvanceStatus,
  updatePaymentStatus,
  getOrderStatusHistory,
  getClientOrderStatusHistory,
  cancelOwnOrder,
  getOrderActivity,
};
