'use strict';

const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const { ROLES } = require('../../constants/portal/roles');
const { Client, Order, Payment, KycDocument, SupportTicket } = require('../../models/portal');
const { sendSuccess } = require('../../utils/portal/apiResponse');

router.use(authenticate, requireRole(ROLES.SUPER_ADMIN));

function paise(v) { return (v || 0) / 100; }

function computeHealthScore(item) {
  let score = 50;
  if (item.status === 'ACTIVE') score += 15;
  if (item.status === 'SUSPENDED') score -= 25;
  if ((item.completedOrders || 0) > 0) score += 15;
  if ((item.totalRevenue || 0) > 0) score += 10;
  if (item.kycStatus === 'VERIFIED') score += 10;
  if ((item.openTickets || 0) > 0) score -= 10;
  if (item.lastOrderAt) {
    const daysSince = (Date.now() - new Date(item.lastOrderAt)) / 86400000;
    if (daysSince > 90) score -= 15;
    else if (daysSince < 30) score += 5;
  } else {
    score -= 10;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}
function computeChurnRisk(score) {
  if (score < 35) return 'HIGH';
  if (score < 55) return 'MEDIUM';
  return 'LOW';
}

// ── CLIENT INTELLIGENCE ───────────────────────────────────────────────────────
// Returns enriched client list with order/payment stats for CRM segments.
router.get('/clients', async (req, res, next) => {
  try {
    const { segment, page = 1, limit = 20, search } = req.query;
    const pg = Math.max(parseInt(page) || 1, 1);
    const lm = Math.min(parseInt(limit) || 20, 100);

    // Base client filter
    const clientFilter = {};
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      clientFilter.$or = [{ name: re }, { companyName: re }, { email: re }, { clientCode: re }, { legacyClientCode: re }, { legacyCode: re }];
    }

    // Apply segment filter at DB level where possible
    if (segment === 'SUSPENDED') clientFilter.status = 'SUSPENDED';
    if (segment === 'PENDING') clientFilter.status = 'PENDING';
    if (segment === 'ACTIVE') clientFilter.status = 'ACTIVE';

    const [clients, total] = await Promise.all([
      Client.find(clientFilter)
        .sort({ createdAt: -1 })
        .skip((pg - 1) * lm)
        .limit(lm)
        .populate('user', '_id')
        .populate('assignedAdmin', 'name adminCode'),
    Client.countDocuments(clientFilter),
    ]);

    // Enrich each client with aggregated stats
    const clientIds = clients.map((c) => c._id);

    const [orderStats, paymentStats, kycStats, ticketStats] = await Promise.all([
      Order.aggregate([
        { $match: { client: { $in: clientIds } } },
        {
          $group: {
            _id: '$client',
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
            lastOrderAt: { $max: '$createdAt' },
          },
        },
      ]),
      Payment.aggregate([
        { $match: { client: { $in: clientIds }, status: 'CONFIRMED' } },
        { $group: { _id: '$client', revenue: { $sum: '$amountPaise' }, lastPaidAt: { $max: '$paidAt' } } },
      ]),
      KycDocument.aggregate([
        { $match: { client: { $in: clientIds }, isCurrentVersion: true } },
        { $group: { _id: '$client', kycStatus: { $last: '$status' } } },
      ]),
      SupportTicket.aggregate([
        { $match: { client: { $in: clientIds }, status: 'OPEN' } },
        { $group: { _id: '$client', openTickets: { $sum: 1 } } },
      ]),
    ]);

    const orderMap = Object.fromEntries(orderStats.map((s) => [s._id.toString(), s]));
    const payMap = Object.fromEntries(paymentStats.map((s) => [s._id.toString(), s]));
    const kycMap = Object.fromEntries(kycStats.map((s) => [s._id.toString(), s]));
    const ticketMap = Object.fromEntries(ticketStats.map((s) => [s._id.toString(), s]));

    let items = clients.map((c) => {
      const id = c._id.toString();
      const orders = orderMap[id] || {};
      const pay = payMap[id] || {};
      const kyc = kycMap[id] || {};
      const ticket = ticketMap[id] || {};
      const itemData = {
        id: c._id,
        clientCode: c.clientCode,
        name: c.name || c.clientCode,
        company: c.companyName || null,
        email: c.email || null,
        phone: c.phone || null,
        status: c.status,
        assignedAdmin: c.assignedAdmin ? { name: c.assignedAdmin.name, adminCode: c.assignedAdmin.adminCode } : null,
        totalOrders: orders.total || 0,
        completedOrders: orders.completed || 0,
        cancelledOrders: orders.cancelled || 0,
        lastOrderAt: orders.lastOrderAt || null,
        totalRevenue: paise(pay.revenue || 0),
        lastPaymentAt: pay.lastPaidAt || null,
        kycStatus: kyc.kycStatus || null,
        openTickets: ticket.openTickets || 0,
        createdAt: c.createdAt,
      };
      const healthScore = computeHealthScore(itemData);
      return { ...itemData, healthScore, churnRisk: computeChurnRisk(healthScore) };
    });

    // Post-filter for segments that require computed values
    if (segment === 'HIGH_VALUE') items = items.filter((c) => c.totalRevenue >= 50000);
    if (segment === 'NEW') {
      const d = new Date(); d.setDate(d.getDate() - 30);
      items = items.filter((c) => new Date(c.createdAt) >= d);
    }
    if (segment === 'INACTIVE') {
      const d = new Date(); d.setDate(d.getDate() - 90);
      items = items.filter((c) => !c.lastOrderAt || new Date(c.lastOrderAt) < d);
    }
    if (segment === 'PENDING_PAYMENT') items = items.filter((c) => c.totalOrders > c.completedOrders + c.cancelledOrders);
    if (segment === 'OPEN_TICKETS') items = items.filter((c) => c.openTickets > 0);

    sendSuccess(res, {
      message: 'CRM intelligence.',
      data: items,
      meta: { page: pg, limit: lm, total, totalPages: Math.max(1, Math.ceil(total / lm)) },
    });
  } catch (err) { next(err); }
});

// ── SEGMENT COUNTS ─────────────────────────────────────────────────────────────
// Returns counts keyed by the segment names the CRM frontend expects.
router.get('/segments', async (req, res, next) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);
    const ninetyDaysAgo = new Date(now); ninetyDaysAgo.setDate(now.getDate() - 90);

    // Get all client IDs for joins
    const allClientIds = await Client.find({}).distinct('_id');

    // Orders with last activity per client
    const lastOrderAgg = await Order.aggregate([
      { $group: { _id: '$client', lastOrderAt: { $max: '$createdAt' } } },
    ]);
    const lastOrderMap = Object.fromEntries(lastOrderAgg.map((r) => [r._id.toString(), r.lastOrderAt]));

    // HIGH_VALUE: confirmed payment total >= ₹50,000 (5,000,000 paise)
    const highValueAgg = await Payment.aggregate([
      { $match: { status: 'CONFIRMED', client: { $in: allClientIds } } },
      { $group: { _id: '$client', total: { $sum: '$amountPaise' } } },
      { $match: { total: { $gte: 5000000 } } },
    ]);

    const [total, active, suspended, pending] = await Promise.all([
      Client.countDocuments({}),
      Client.countDocuments({ status: 'ACTIVE' }),
      Client.countDocuments({ status: 'SUSPENDED' }),
      Client.countDocuments({ status: 'PENDING' }),
    ]);

    const newClients = await Client.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
    const highValueCount = highValueAgg.length;

    // INACTIVE: no order in last 90 days (or no orders at all), active clients only
    const activeClientIds = await Client.find({ status: 'ACTIVE' }).distinct('_id');
    const inactiveCount = activeClientIds.filter((id) => {
      const last = lastOrderMap[id.toString()];
      return !last || last < ninetyDaysAgo;
    }).length;

    // AT_RISK: suspended + pending (accounts with access issues)
    const atRiskCount = suspended + pending;

    // CHURNED: active clients with only cancelled/closed orders and no new order in 6 months
    const sixMonthsAgo = new Date(now); sixMonthsAgo.setMonth(now.getMonth() - 6);
    const churnedCount = activeClientIds.filter((id) => {
      const last = lastOrderMap[id.toString()];
      return last && last < sixMonthsAgo;
    }).length;

    // REGULAR: active clients not in high-value, not new, not inactive
    const highValueIds = new Set(highValueAgg.map((r) => r._id.toString()));
    const newClientIds = await Client.find({ createdAt: { $gte: thirtyDaysAgo } }).distinct('_id');
    const newClientIdSet = new Set(newClientIds.map((id) => id.toString()));
    const regularCount = activeClientIds.filter((id) => {
      const s = id.toString();
      const last = lastOrderMap[s];
      const isInactive = !last || last < ninetyDaysAgo;
      return !highValueIds.has(s) && !newClientIdSet.has(s) && !isInactive;
    }).length;

    sendSuccess(res, {
      message: 'Segments.',
      data: {
        total,
        HIGH_VALUE: highValueCount,
        NEW: newClients,
        REGULAR: regularCount,
        AT_RISK: atRiskCount,
        INACTIVE: inactiveCount,
        CHURNED: churnedCount,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
