const { Order, Payment, Client, Service, User, KycDocument, CommunicationLog, OrderStatusHistory, OrderAssignmentHistory, SupportTicket, Task } = require('../../models/portal');
const { ORDER_STATUS, ALL_ORDER_STATUSES } = require('../../constants/portal/orderStatus');
const { ORDER_PAYMENT_STATUS } = require('../../constants/portal/orderPaymentStatus');
const { PAYMENT_ATTEMPT_STATUS } = require('../../constants/portal/paymentAttemptStatus');
const { KYC_DOCUMENT_STATUS } = require('../../constants/portal/kycStatus');
const { CLIENT_STATUS } = require('../../constants/portal/clientStatus');
const { ROLES } = require('../../constants/portal/roles');
const { paiseToRupees } = require('./money.service');

/**
 * All amounts are summed/returned in integer paise internally; conversion
 * to rupees happens only at this layer's own return boundary (never a
 * frontend calculation) via money.service.js's existing paiseToRupees -
 * never duplicated float arithmetic.
 */
function money(minor) {
  return { minor: minor || 0, amount: paiseToRupees(minor || 0) };
}

// --- Overview ----------------------------------------------------------

async function getOverview({ orderScopeFilter, clientScopeFilter, from, to }) {
  const orderDateFilter = { ...orderScopeFilter, createdAt: { $gte: from, $lte: to } };

  const [
    totalClients,
    activeClients,
    totalOrders,
    openOrders,
    completedOrders,
    cancelledOrders,
    kycPending,
    kycSubmitted,
    kycVerification,
    kycRejected,
  ] = await Promise.all([
    Client.countDocuments(clientScopeFilter),
    Client.countDocuments({ ...clientScopeFilter, status: CLIENT_STATUS.ACTIVE }),
    Order.countDocuments(orderDateFilter),
    Order.countDocuments({
      ...orderDateFilter,
      status: { $nin: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED, ORDER_STATUS.CANCELLED] },
    }),
    Order.countDocuments({ ...orderDateFilter, status: { $in: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED] } }),
    Order.countDocuments({ ...orderDateFilter, status: ORDER_STATUS.CANCELLED }),
    Order.countDocuments({ ...orderDateFilter, status: ORDER_STATUS.KYC_PENDING }),
    Order.countDocuments({ ...orderDateFilter, status: ORDER_STATUS.KYC_SUBMITTED }),
    Order.countDocuments({ ...orderDateFilter, status: ORDER_STATUS.KYC_VERIFICATION }),
    Order.countDocuments({ ...orderDateFilter, status: ORDER_STATUS.KYC_REJECTED }),
  ]);

  // Revenue: authoritative source is Payment, not Order.pricing - see
  // getRevenue() below for the full breakdown/rationale. Scoped the same
  // way (orders within the caller's scope) via a $lookup-free order-id-list
  // approach kept here lightweight for the overview card.
  const scopedOrderIds = await Order.find(orderScopeFilter).distinct('_id');
  const [paidAgg, pendingAgg, refundedAgg] = await Promise.all([
    Payment.aggregate([
      { $match: { order: { $in: scopedOrderIds }, status: PAYMENT_ATTEMPT_STATUS.CONFIRMED, paidAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]),
    Order.aggregate([
      { $match: { ...orderDateFilter, paymentStatus: ORDER_PAYMENT_STATUS.PENDING } },
      { $group: { _id: null, total: { $sum: '$pricing.totalAmountMinor' } } },
    ]),
    Payment.aggregate([
      { $match: { order: { $in: scopedOrderIds }, status: PAYMENT_ATTEMPT_STATUS.REFUNDED, refundedAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$refundAmountPaise' } } },
    ]),
  ]);

  return {
    summary: {
      totalClients,
      activeClients,
      totalOrders,
      openOrders,
      completedOrders,
      cancelledOrders,
      totalRevenue: money(paidAgg[0]?.total),
      paidRevenue: money(paidAgg[0]?.total),
      pendingPaymentAmount: money(pendingAgg[0]?.total),
      refundedAmount: money(refundedAgg[0]?.total),
      kycPending,
      kycInReview: kycSubmitted + kycVerification,
      kycRejected,
    },
  };
}

// --- Orders --------------------------------------------------------------

async function getOrderAnalytics({ orderScopeFilter, from, to }) {
  const baseFilter = { ...orderScopeFilter, createdAt: { $gte: from, $lte: to } };

  const statusCountsAgg = await Order.aggregate([
    { $match: baseFilter },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const byStatus = {};
  for (const s of ALL_ORDER_STATUSES) byStatus[s] = 0;
  for (const row of statusCountsAgg) byStatus[row._id] = row.count;

  const seriesAgg = await Order.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        created: { $sum: 1 },
        completed: { $sum: { $cond: [{ $in: ['$status', [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED]] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.CANCELLED] }, 1, 0] } },
        valueMinor: { $sum: '$pricing.totalAmountMinor' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const [{ totalCount, totalValue } = { totalCount: 0, totalValue: 0 }] = await Order.aggregate([
    { $match: baseFilter },
    { $group: { _id: null, totalCount: { $sum: 1 }, totalValue: { $sum: '$pricing.totalAmountMinor' } } },
  ]);

  return {
    summary: {
      totalOrders: totalCount,
      completedOrders: byStatus[ORDER_STATUS.COMPLETED] + byStatus[ORDER_STATUS.CLOSED],
      cancelledOrders: byStatus[ORDER_STATUS.CANCELLED],
      averageOrderValue: money(totalCount > 0 ? Math.round(totalValue / totalCount) : 0),
      totalOrderValue: money(totalValue),
    },
    breakdowns: { byStatus },
    series: seriesAgg.map((r) => ({
      date: r._id,
      created: r.created,
      completed: r.completed,
      cancelled: r.cancelled,
      value: money(r.valueMinor).amount,
    })),
  };
}

// --- Revenue ---------------------------------------------------------------

/**
 * Revenue is computed from Payment (the authoritative record of actual
 * money movement), never by summing Order.pricing directly - an Order can
 * exist with no successful payment at all. `paidAt`/`refundedAt` (the
 * moment money actually moved) are used for date filtering, not the
 * Payment attempt's `createdAt`, so a report for "today" reflects money
 * that moved today.
 */
async function getRevenueAnalytics({ orderScopeFilter, from, to }) {
  const scopedOrderIds = await Order.find(orderScopeFilter).distinct('_id');
  const orderMatch = { order: { $in: scopedOrderIds } };

  const [paidAgg, failedAgg, refundedAgg] = await Promise.all([
    Payment.aggregate([
      { $match: { ...orderMatch, status: PAYMENT_ATTEMPT_STATUS.CONFIRMED, paidAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { ...orderMatch, status: PAYMENT_ATTEMPT_STATUS.FAILED, failedAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { ...orderMatch, status: PAYMENT_ATTEMPT_STATUS.REFUNDED, refundedAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$refundAmountPaise' }, count: { $sum: 1 } } },
    ]),
  ]);

  const pendingAgg = await Order.aggregate([
    { $match: { ...orderScopeFilter, paymentStatus: ORDER_PAYMENT_STATUS.PENDING, createdAt: { $gte: from, $lte: to } } },
    { $group: { _id: null, total: { $sum: '$pricing.totalAmountMinor' } } },
  ]);

  const byDay = await Payment.aggregate([
    { $match: { ...orderMatch, status: PAYMENT_ATTEMPT_STATUS.CONFIRMED, paidAt: { $gte: from, $lte: to } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } }, total: { $sum: '$amountPaise' } } },
    { $sort: { _id: 1 } },
  ]);

  const byService = await Payment.aggregate([
    { $match: { ...orderMatch, status: PAYMENT_ATTEMPT_STATUS.CONFIRMED, paidAt: { $gte: from, $lte: to } } },
    { $lookup: { from: 'orders', localField: 'order', foreignField: '_id', as: 'orderDoc' } },
    { $unwind: '$orderDoc' },
    { $group: { _id: '$orderDoc.service', total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'serviceDoc' } },
    { $unwind: { path: '$serviceDoc', preserveNullAndEmptyArrays: true } },
    { $project: { serviceName: { $ifNull: ['$serviceDoc.name', 'Unknown'] }, total: 1, count: 1 } },
    { $sort: { total: -1 } },
  ]);

  const grossPaid = paidAgg[0]?.total || 0;
  const refunded = refundedAgg[0]?.total || 0;

  return {
    summary: {
      grossPaidAmount: money(grossPaid),
      pendingAmount: money(pendingAgg[0]?.total),
      failedAmount: money(failedAgg[0]?.total),
      refundedAmount: money(refunded),
      netPaidAmount: money(grossPaid - refunded),
      paidPaymentCount: paidAgg[0]?.count || 0,
      failedPaymentCount: failedAgg[0]?.count || 0,
      refundedPaymentCount: refundedAgg[0]?.count || 0,
    },
    series: byDay.map((r) => ({ date: r._id, amount: money(r.total).amount })),
    breakdowns: {
      byService: byService.map((r) => ({ serviceId: r._id, serviceName: r.serviceName, amount: money(r.total).amount, count: r.count })),
    },
  };
}

// --- Services ------------------------------------------------------------

async function getServiceAnalytics({ orderScopeFilter, from, to, sort = 'orderCount' }) {
  const sortField = { orderCount: 'totalOrders', revenue: 'revenueMinor', completions: 'completedOrders' }[sort] || 'totalOrders';

  const rows = await Order.aggregate([
    { $match: { ...orderScopeFilter, createdAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: '$service',
        totalOrders: { $sum: 1 },
        completedOrders: { $sum: { $cond: [{ $in: ['$status', [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED]] }, 1, 0] } },
        cancelledOrders: { $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.CANCELLED] }, 1, 0] } },
        pendingOrders: {
          $sum: { $cond: [{ $not: [{ $in: ['$status', [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED, ORDER_STATUS.CANCELLED]] }] }, 1, 0] },
        },
        revenueMinor: { $sum: { $cond: [{ $ne: ['$status', ORDER_STATUS.CANCELLED] }, '$pricing.totalAmountMinor', 0] } },
      },
    },
    { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'service' } },
    { $unwind: { path: '$service', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        serviceId: '$_id',
        serviceName: { $ifNull: ['$service.name', 'Deleted/Unknown Service'] },
        serviceCode: { $ifNull: ['$service.serviceCode', null] },
        totalOrders: 1,
        completedOrders: 1,
        cancelledOrders: 1,
        pendingOrders: 1,
        revenueMinor: 1,
        averageOrderValueMinor: { $cond: [{ $gt: ['$totalOrders', 0] }, { $divide: ['$revenueMinor', '$totalOrders'] }, 0] },
      },
    },
    { $sort: { [sortField]: -1 } },
  ]);

  return {
    breakdowns: {
      services: rows.map((r) => ({
        serviceId: r.serviceId,
        serviceName: r.serviceName,
        serviceCode: r.serviceCode,
        totalOrders: r.totalOrders,
        completedOrders: r.completedOrders,
        cancelledOrders: r.cancelledOrders,
        pendingOrders: r.pendingOrders,
        revenue: money(r.revenueMinor).amount,
        averageOrderValue: money(Math.round(r.averageOrderValueMinor)).amount,
      })),
    },
  };
}

// --- Clients ---------------------------------------------------------------

async function getClientAnalytics({ clientScopeFilter, orderScopeFilter, from, to, page = 1, limit = 20 }) {
  const [totalClients, activeClients, inactiveClients, newClients] = await Promise.all([
    Client.countDocuments(clientScopeFilter),
    Client.countDocuments({ ...clientScopeFilter, status: CLIENT_STATUS.ACTIVE }),
    Client.countDocuments({ ...clientScopeFilter, status: { $ne: CLIENT_STATUS.ACTIVE } }),
    Client.countDocuments({ ...clientScopeFilter, createdAt: { $gte: from, $lte: to } }),
  ]);

  const perClient = await Order.aggregate([
    { $match: { ...orderScopeFilter, createdAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: '$client',
        totalOrders: { $sum: 1 },
        completedOrders: { $sum: { $cond: [{ $in: ['$status', [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED]] }, 1, 0] } },
        pendingOrders: {
          $sum: { $cond: [{ $not: [{ $in: ['$status', [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED, ORDER_STATUS.CANCELLED]] }] }, 1, 0] },
        },
        revenueMinor: { $sum: { $cond: [{ $ne: ['$status', ORDER_STATUS.CANCELLED] }, '$pricing.totalAmountMinor', 0] } },
      },
    },
    { $match: { _id: { $in: await Client.find(clientScopeFilter).distinct('_id') } } },
    { $sort: { revenueMinor: -1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    { $lookup: { from: 'clients', localField: '_id', foreignField: '_id', as: 'client' } },
    { $unwind: '$client' },
    {
      $project: {
        clientId: '$_id',
        clientCode: '$client.clientCode',
        name: '$client.name',
        companyName: '$client.companyName',
        totalOrders: 1,
        completedOrders: 1,
        pendingOrders: 1,
        revenueMinor: 1,
      },
    },
  ]);

  return {
    summary: { totalClients, activeClients, inactiveClients, newClients },
    breakdowns: {
      clients: perClient.map((r) => ({
        clientId: r.clientId,
        clientCode: r.clientCode,
        name: r.name,
        companyName: r.companyName,
        totalOrders: r.totalOrders,
        completedOrders: r.completedOrders,
        pendingOrders: r.pendingOrders,
        revenue: money(r.revenueMinor).amount,
      })),
    },
    meta: { page, limit },
  };
}

// --- Admin / operational performance ---------------------------------------

/**
 * Only objective, measurable counts - never a synthesized "performance
 * score" or subjective ranking (Phase 11 spec is explicit about this).
 */
async function getAdminAnalytics({ user, from, to }) {
  const adminFilter = user.role === ROLES.SUPER_ADMIN ? { role: ROLES.ADMIN } : { role: ROLES.ADMIN, _id: user._id };
  const adminIds = await User.find(adminFilter).distinct('_id');

  const orderMetrics = await Order.aggregate([
    { $match: { assignedAdmin: { $in: adminIds }, createdAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: '$assignedAdmin',
        assignedOrders: { $sum: 1 },
        completedOrders: { $sum: { $cond: [{ $in: ['$status', [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED]] }, 1, 0] } },
        cancelledOrders: { $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.CANCELLED] }, 1, 0] } },
        openOrders: {
          $sum: { $cond: [{ $not: [{ $in: ['$status', [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED, ORDER_STATUS.CANCELLED]] }] }, 1, 0] },
        },
      },
    },
  ]);

  const kycReviewCounts = await KycDocument.aggregate([
    { $match: { reviewedBy: { $in: adminIds }, reviewedAt: { $gte: from, $lte: to } } },
    { $group: { _id: { admin: '$reviewedBy', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const byAdmin = new Map();
  for (const id of adminIds) byAdmin.set(String(id), { assignedOrders: 0, completedOrders: 0, cancelledOrders: 0, openOrders: 0, kycVerified: 0, kycRejected: 0 });
  for (const row of orderMetrics) {
    const entry = byAdmin.get(String(row._id));
    if (entry) Object.assign(entry, { assignedOrders: row.assignedOrders, completedOrders: row.completedOrders, cancelledOrders: row.cancelledOrders, openOrders: row.openOrders });
  }
  for (const row of kycReviewCounts) {
    const entry = byAdmin.get(String(row._id.admin));
    if (!entry) continue;
    if (row._id.status === KYC_DOCUMENT_STATUS.VERIFIED) entry.kycVerified = row.count;
    if (row._id.status === KYC_DOCUMENT_STATUS.REJECTED) entry.kycRejected = row.count;
  }

  const admins = await User.find({ _id: { $in: adminIds } }).select('name email');
  const breakdown = admins.map((a) => ({ adminId: a._id, name: a.name, email: a.email, ...byAdmin.get(String(a._id)) }));

  return { breakdowns: { admins: breakdown } };
}

// --- KYC ---------------------------------------------------------------

async function getKycAnalytics({ orderScopeFilter, from, to }) {
  const baseFilter = { ...orderScopeFilter, createdAt: { $gte: from, $lte: to } };
  const [pending, submitted, verification, rejected] = await Promise.all([
    Order.countDocuments({ ...baseFilter, status: ORDER_STATUS.KYC_PENDING }),
    Order.countDocuments({ ...baseFilter, status: ORDER_STATUS.KYC_SUBMITTED }),
    Order.countDocuments({ ...baseFilter, status: ORDER_STATUS.KYC_VERIFICATION }),
    Order.countDocuments({ ...baseFilter, status: ORDER_STATUS.KYC_REJECTED }),
  ]);

  const scopedOrderIds = await Order.find(orderScopeFilter).distinct('_id');
  const [verifiedDocs, rejectedDocs] = await Promise.all([
    KycDocument.countDocuments({ order: { $in: scopedOrderIds }, status: KYC_DOCUMENT_STATUS.VERIFIED, reviewedAt: { $gte: from, $lte: to } }),
    KycDocument.countDocuments({ order: { $in: scopedOrderIds }, status: KYC_DOCUMENT_STATUS.REJECTED, reviewedAt: { $gte: from, $lte: to } }),
  ]);

  // Average verification time: from upload (createdAt) to the review
  // decision (reviewedAt), for documents that reached a terminal
  // VERIFIED/REJECTED state in-range. Never includes document bytes/storage
  // keys - only the two timestamps.
  const [avgAgg] = await KycDocument.aggregate([
    {
      $match: {
        order: { $in: scopedOrderIds },
        status: { $in: [KYC_DOCUMENT_STATUS.VERIFIED, KYC_DOCUMENT_STATUS.REJECTED] },
        reviewedAt: { $gte: from, $lte: to, $ne: null },
      },
    },
    { $project: { hours: { $divide: [{ $subtract: ['$reviewedAt', '$createdAt'] }, 1000 * 60 * 60] } } },
    { $group: { _id: null, avgHours: { $avg: '$hours' } } },
  ]);

  return {
    summary: {
      kycPending: pending,
      kycSubmitted: submitted,
      kycInVerification: verification,
      kycRejected: rejected,
      documentsVerified: verifiedDocs,
      documentsRejected: rejectedDocs,
      averageVerificationHours: avgAgg?.avgHours != null ? Math.round(avgAgg.avgHours * 10) / 10 : null,
    },
  };
}

// --- Payments ----------------------------------------------------------

async function getPaymentAnalytics({ orderScopeFilter, from, to }) {
  const scopedOrderIds = await Order.find(orderScopeFilter).distinct('_id');
  const orderMatch = { order: { $in: scopedOrderIds } };

  const counts = await Payment.aggregate([
    { $match: { ...orderMatch, createdAt: { $gte: from, $lte: to } } },
    { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amountPaise' } } },
  ]);

  const byStatus = {};
  for (const s of Object.values(PAYMENT_ATTEMPT_STATUS)) byStatus[s] = { count: 0, amount: 0 };
  for (const row of counts) byStatus[row._id] = { count: row.count, amount: row.amount };

  const totalAttempts = Object.values(byStatus).reduce((sum, v) => sum + v.count, 0);
  const successCount = byStatus[PAYMENT_ATTEMPT_STATUS.CONFIRMED].count;

  return {
    summary: {
      successfulPayments: successCount,
      pendingPayments: byStatus[PAYMENT_ATTEMPT_STATUS.CREATED].count,
      failedPayments: byStatus[PAYMENT_ATTEMPT_STATUS.FAILED].count,
      refundedPayments: byStatus[PAYMENT_ATTEMPT_STATUS.REFUNDED].count,
      totalPaidAmount: money(byStatus[PAYMENT_ATTEMPT_STATUS.CONFIRMED].amount),
      totalRefundedAmount: money(byStatus[PAYMENT_ATTEMPT_STATUS.REFUNDED].amount),
      // Only meaningful once at least one attempt has reached a terminal
      // outcome - never divide by zero into a misleading 0%/NaN.
      paymentSuccessRate: totalAttempts > 0 ? Math.round((successCount / totalAttempts) * 1000) / 10 : null,
    },
  };
}

// --- Communications ------------------------------------------------------

/**
 * Reports ONLY states this app's database actually knows. "DELIVERED" is
 * included as its own bucket (distinct from SENT) but never inferred -
 * it only reflects CommunicationLog rows a provider webhook actually
 * marked DELIVERED, which (per Phase 9/10) none currently are, since no
 * delivery-status webhook is implemented yet. SENT means "provider
 * accepted it", nothing more.
 */
async function getCommunicationAnalytics({ orderScopeFilter, from, to }) {
  const scopedOrderIds = await Order.find(orderScopeFilter).distinct('_id');

  const rows = await CommunicationLog.aggregate([
    { $match: { order: { $in: scopedOrderIds }, createdAt: { $gte: from, $lte: to } } },
    { $group: { _id: { channel: '$channel', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const byChannel = {};
  for (const row of rows) {
    const channel = row._id.channel;
    if (!byChannel[channel]) byChannel[channel] = { sent: 0, delivered: 0, failed: 0, retrying: 0, queued: 0 };
    const bucket = byChannel[channel];
    if (row._id.status === 'SENT') bucket.sent += row.count;
    else if (row._id.status === 'DELIVERED') bucket.delivered += row.count;
    else if (row._id.status === 'FAILED') bucket.failed += row.count;
    else if (row._id.status === 'RETRYING') bucket.retrying += row.count;
    else if (row._id.status === 'QUEUED') bucket.queued += row.count;
  }

  return { breakdowns: { byChannel } };
}

// --- Funnel --------------------------------------------------------------

/**
 * Built from OrderStatusHistory - the actual recorded lifecycle
 * transitions - rather than assuming every order marches through every
 * stage linearly (cancellation/KYC rejection/payment failure all exist
 * as legitimate exits, per Phase 11 spec).
 */
async function getFunnel({ orderScopeFilter, from, to }) {
  const scopedOrderIds = await Order.find(orderScopeFilter).distinct('_id');

  const edges = [
    [ORDER_STATUS.CREATED, ORDER_STATUS.PAYMENT_PENDING],
    [ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.PAYMENT_CONFIRMED],
    [ORDER_STATUS.PAYMENT_CONFIRMED, ORDER_STATUS.ASSIGNED],
    [ORDER_STATUS.ASSIGNED, ORDER_STATUS.KYC_PENDING],
    [ORDER_STATUS.KYC_VERIFICATION, ORDER_STATUS.IN_PROGRESS],
    [ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.COMPLETED],
    [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED],
  ];

  const counts = await Promise.all(
    edges.map(([fromStatus, toStatus]) =>
      OrderStatusHistory.countDocuments({
        order: { $in: scopedOrderIds },
        fromStatus,
        toStatus,
        createdAt: { $gte: from, $lte: to },
      })
    )
  );

  const [cancelledCount, kycRejectedCount] = await Promise.all([
    OrderStatusHistory.countDocuments({ order: { $in: scopedOrderIds }, toStatus: ORDER_STATUS.CANCELLED, createdAt: { $gte: from, $lte: to } }),
    OrderStatusHistory.countDocuments({ order: { $in: scopedOrderIds }, toStatus: ORDER_STATUS.KYC_REJECTED, createdAt: { $gte: from, $lte: to } }),
  ]);

  return {
    series: edges.map(([fromStatus, toStatus], i) => ({ from: fromStatus, to: toStatus, count: counts[i] })),
    breakdowns: { exits: { cancelled: cancelledCount, kycRejected: kycRejectedCount } },
  };
}

// --- Support Ticket Analytics -------------------------------------------

async function getSupportAnalytics({ from, to }) {
  const dateFilter = { createdAt: { $gte: from, $lte: to } };

  const [total, open, inProgress, resolved, closed, critical, high, medium, low] = await Promise.all([
    SupportTicket.countDocuments(dateFilter),
    SupportTicket.countDocuments({ ...dateFilter, status: 'OPEN' }),
    SupportTicket.countDocuments({ ...dateFilter, status: 'IN_PROGRESS' }),
    SupportTicket.countDocuments({ ...dateFilter, status: 'RESOLVED' }),
    SupportTicket.countDocuments({ ...dateFilter, status: 'CLOSED' }),
    SupportTicket.countDocuments({ ...dateFilter, priority: 'CRITICAL' }),
    SupportTicket.countDocuments({ ...dateFilter, priority: 'HIGH' }),
    SupportTicket.countDocuments({ ...dateFilter, priority: 'MEDIUM' }),
    SupportTicket.countDocuments({ ...dateFilter, priority: 'LOW' }),
  ]);

  const dailySeries = await SupportTicket.aggregate([
    { $match: dateFilter },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { date: '$_id', count: 1, _id: 0 } },
  ]);

  return {
    summary: { total, open, inProgress, resolved, closed },
    series: dailySeries,
    breakdowns: { byPriority: { critical, high, medium, low } },
  };
}

// --- Task Analytics ------------------------------------------------------

async function getTaskAnalytics({ from, to }) {
  const dateFilter = { createdAt: { $gte: from, $lte: to } };

  const [total, pending, inProgress, completed, overdue] = await Promise.all([
    Task.countDocuments(dateFilter),
    Task.countDocuments({ ...dateFilter, status: 'PENDING' }),
    Task.countDocuments({ ...dateFilter, status: 'IN_PROGRESS' }),
    Task.countDocuments({ ...dateFilter, status: 'COMPLETED' }),
    Task.countDocuments({ ...dateFilter, status: 'OVERDUE' }),
  ]);

  const byAssignee = await Task.aggregate([
    { $match: { ...dateFilter, assignedTo: { $ne: null } } },
    { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $project: { adminName: { $arrayElemAt: ['$user.name', 0] }, count: 1, _id: 0 } },
  ]);

  const dailySeries = await Task.aggregate([
    { $match: dateFilter },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $project: { date: '$_id', count: 1, _id: 0 } },
  ]);

  return {
    summary: { total, pending, inProgress, completed, overdue },
    series: dailySeries,
    breakdowns: { byAssignee },
  };
}

module.exports = {
  getOverview,
  getOrderAnalytics,
  getRevenueAnalytics,
  getServiceAnalytics,
  getClientAnalytics,
  getAdminAnalytics,
  getKycAnalytics,
  getPaymentAnalytics,
  getCommunicationAnalytics,
  getFunnel,
  getSupportAnalytics,
  getTaskAnalytics,
};
