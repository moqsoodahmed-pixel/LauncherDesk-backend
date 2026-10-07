'use strict';

const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const { ROLES } = require('../../constants/portal/roles');
const { Payment, Order } = require('../../models/portal');
const { sendSuccess } = require('../../utils/portal/apiResponse');

router.use(authenticate, requireRole(ROLES.SUPER_ADMIN));

// ── HELPER ──────────────────────────────────────────────────────────────────
function paise(v) { return (v || 0) / 100; }

function periodBounds(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  switch (period) {
    case 'today':
      return { $gte: today };
    case 'yesterday':
      return { $gte: yesterday, $lt: today };
    case 'week': {
      const d = new Date(today); d.setDate(today.getDate() - 7);
      return { $gte: d };
    }
    case 'month': {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      return { $gte: d };
    }
    case 'quarter': {
      const q = Math.floor(today.getMonth() / 3);
      const d = new Date(today.getFullYear(), q * 3, 1);
      return { $gte: d };
    }
    case 'year': {
      const d = new Date(today.getFullYear(), 0, 1);
      return { $gte: d };
    }
    default: return null;
  }
}

async function periodRevenue(period) {
  const range = periodBounds(period);
  const match = { status: 'CONFIRMED' };
  if (range) match.paidAt = range;
  const [res] = await Payment.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } }]);
  return { total: paise(res?.total || 0), count: res?.count || 0 };
}

// Build per-period stats in the shape the frontend expects:
// { grossRevenue, netRevenue, gstCollected, refundsIssued, refundCount,
//   confirmedCount, pendingCount, failedCount, avgOrderValue }
async function buildPeriodStats(paidAtFilter) {
  const confirmedMatch = { status: 'CONFIRMED' };
  const refundedMatch  = { status: 'REFUNDED' };
  const createdMatch   = { status: 'CREATED' };
  const failedMatch    = { status: 'FAILED' };
  if (paidAtFilter) {
    confirmedMatch.paidAt  = paidAtFilter;
    refundedMatch.refundedAt = paidAtFilter;
    createdMatch.createdAt = paidAtFilter;
    failedMatch.failedAt   = paidAtFilter;
  }

  // pendingCount = orders awaiting payment (paymentStatus PENDING), consistent with Payments page
  const orderPendingFilter = { paymentStatus: 'PENDING', ...(paidAtFilter ? { createdAt: paidAtFilter } : {}) };
  const [confAgg, refAgg, pendCount, failCount, gstAgg] = await Promise.all([
    Payment.aggregate([{ $match: confirmedMatch }, { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 }, avg: { $avg: '$amountPaise' } } }]),
    Payment.aggregate([{ $match: refundedMatch }, { $group: { _id: null, total: { $sum: '$refundAmountPaise' }, count: { $sum: 1 } } }]),
    Order.countDocuments(orderPendingFilter),
    Payment.countDocuments(failedMatch),
    Order.aggregate([
      { $match: { paymentStatus: 'PAID', ...(paidAtFilter ? { updatedAt: paidAtFilter } : {}) } },
      { $group: { _id: null, gst: { $sum: '$pricing.gstAmountMinor' } } },
    ]),
  ]);

  const grossRevenue = paise(confAgg[0]?.total || 0);
  const refundsIssued = paise(refAgg[0]?.total || 0);
  return {
    grossRevenue,
    netRevenue: Math.max(0, grossRevenue - refundsIssued),
    gstCollected: paise(gstAgg[0]?.gst || 0),
    refundsIssued,
    refundCount: refAgg[0]?.count || 0,
    confirmedCount: confAgg[0]?.count || 0,
    pendingCount: pendCount,
    failedCount: failCount,
    avgOrderValue: paise(confAgg[0]?.avg || 0),
  };
}

// ── FINANCE DASHBOARD ────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res, next) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const yearStart = new Date(today.getFullYear(), 0, 1);

    const [todayStats, weekStats, monthStats, yearStats, allStats, statusBreakdown, gstBreakdown] = await Promise.all([
      buildPeriodStats({ $gte: today }),
      buildPeriodStats({ $gte: weekAgo }),
      buildPeriodStats({ $gte: monthStart }),
      buildPeriodStats({ $gte: yearStart }),
      buildPeriodStats(null),
      // Status breakdown for pie chart — frontend expects { _id, totalRupees }
      Payment.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, totalRupees: { $sum: { $divide: ['$amountPaise', 100] } } } },
      ]),
      // GST breakdown by service
      Order.aggregate([
        { $match: { paymentStatus: 'PAID' } },
        { $group: { _id: '$service', orderCount: { $sum: 1 }, baseAmount: { $sum: { $divide: ['$pricing.baseAmountMinor', 100] } }, gstAmount: { $sum: { $divide: ['$pricing.gstAmountMinor', 100] } } } },
        { $lookup: { from: 'services', localField: '_id', foreignField: '_id', as: 'svc' } },
        { $project: { serviceName: { $ifNull: [{ $arrayElemAt: ['$svc.name', 0] }, 'Unknown'] }, orderCount: 1, baseAmount: 1, gstAmount: 1 } },
        { $sort: { gstAmount: -1 } },
        { $limit: 10 },
      ]),
    ]);

    sendSuccess(res, {
      message: 'Finance dashboard.',
      data: {
        today: todayStats,
        week: weekStats,
        month: monthStats,
        all: allStats,
        statusBreakdown,
        gstBreakdown,
      },
    });
  } catch (err) { next(err); }
});

// ── REVENUE TREND ────────────────────────────────────────────────────────────
router.get('/revenue-trend', async (req, res, next) => {
  try {
    const { months = 12 } = req.query;
    const n = Math.min(parseInt(months) || 12, 24);
    const from = new Date();
    from.setMonth(from.getMonth() - n);

    const data = await Payment.aggregate([
      { $match: { status: 'CONFIRMED', paidAt: { $gte: from } } },
      {
        $group: {
          _id: { year: { $year: '$paidAt' }, month: { $month: '$paidAt' } },
          revenue: { $sum: '$amountPaise' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Frontend AreaChart uses dataKey="grossRevenue", XAxis dataKey="month"
    const trend = data.map((d) => ({
      month: `${d._id.year}-${String(d._id.month).padStart(2, '0')}`,
      grossRevenue: paise(d.revenue),
      netRevenue: paise(d.revenue), // net = gross until refund breakdown added per-month
      count: d.count,
    }));

    sendSuccess(res, { message: 'Revenue trend.', data: trend });
  } catch (err) { next(err); }
});

// ── PAYMENT STATS BY METHOD ───────────────────────────────────────────────────
router.get('/payment-methods', async (req, res, next) => {
  try {
    const data = await Payment.aggregate([
      { $match: { status: 'CONFIRMED', method: { $ne: null } } },
      { $group: { _id: '$method', count: { $sum: 1 }, total: { $sum: '$amountPaise' } } },
      { $sort: { total: -1 } },
    ]);
    // Frontend BarChart uses dataKey="totalRupees", YAxis dataKey="_id"
    sendSuccess(res, { message: 'Payment methods.', data: data.map((d) => ({ _id: d._id, count: d.count, totalRupees: paise(d.total) })) });
  } catch (err) { next(err); }
});

module.exports = router;
