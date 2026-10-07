const reportsService = require('../../services/portal/reports.service');
const { buildOrderScopeFilter, buildClientScopeFilter } = require('../../middleware/portal/dataScope');
const { resolveDateRange, reportMeta } = require('../../services/portal/dateRange.service');
const { sendSuccess } = require('../../utils/portal/apiResponse');
const { toCsv, reportCsvFilename } = require('../../utils/portal/csvExport');

function scopeAndRange(req) {
  const orderScopeFilter = buildOrderScopeFilter(req.user);
  const clientScopeFilter = buildClientScopeFilter(req.user);
  const range = resolveDateRange(req.query);
  return { orderScopeFilter, clientScopeFilter, ...range };
}

function respond(res, result, range) {
  return sendSuccess(res, {
    message: 'Report.',
    data: { summary: result.summary || {}, series: result.series || [], breakdowns: result.breakdowns || {} },
    meta: { ...reportMeta(range), ...(result.meta || {}) },
  });
}

async function overview(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getOverview(ctx);
    return respond(res, result, ctx);
  } catch (err) {
    next(err);
  }
}

async function orders(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getOrderAnalytics(ctx);
    return respond(res, result, ctx);
  } catch (err) {
    next(err);
  }
}

async function revenue(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getRevenueAnalytics(ctx);
    return respond(res, result, ctx);
  } catch (err) {
    next(err);
  }
}

async function services(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getServiceAnalytics({ ...ctx, sort: req.query.sort });
    return respond(res, result, ctx);
  } catch (err) {
    next(err);
  }
}

async function clients(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getClientAnalytics({ ...ctx, page: req.query.page, limit: req.query.limit });
    return respond(res, result, ctx);
  } catch (err) {
    next(err);
  }
}

async function admins(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getAdminAnalytics({ user: req.user, ...ctx });
    return respond(res, result, ctx);
  } catch (err) {
    next(err);
  }
}

async function kyc(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getKycAnalytics(ctx);
    return respond(res, result, ctx);
  } catch (err) {
    next(err);
  }
}

async function payments(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getPaymentAnalytics(ctx);
    return respond(res, result, ctx);
  } catch (err) {
    next(err);
  }
}

async function communications(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getCommunicationAnalytics(ctx);
    return respond(res, result, ctx);
  } catch (err) {
    next(err);
  }
}

async function funnel(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getFunnel(ctx);
    return respond(res, result, ctx);
  } catch (err) {
    next(err);
  }
}

// --- CSV export - only for reports that genuinely benefit (orders, revenue, services). ---

async function exportOrders(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getOrderAnalytics(ctx);
    const columns = [
      { key: 'date', label: 'Date' },
      { key: 'created', label: 'Created' },
      { key: 'completed', label: 'Completed' },
      { key: 'cancelled', label: 'Cancelled' },
      { key: 'value', label: 'Value (INR)' },
    ];
    const csv = toCsv(columns, result.series);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${reportCsvFilename('orders')}"`);
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

async function exportRevenue(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getRevenueAnalytics(ctx);
    const columns = [
      { key: 'date', label: 'Date' },
      { key: 'amount', label: 'Amount (INR)' },
    ];
    const csv = toCsv(columns, result.series);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${reportCsvFilename('revenue')}"`);
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

async function exportServices(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getServiceAnalytics({ ...ctx, sort: req.query.sort });
    const columns = [
      { key: 'serviceName', label: 'Service' },
      { key: 'serviceCode', label: 'Code' },
      { key: 'totalOrders', label: 'Total Orders' },
      { key: 'completedOrders', label: 'Completed' },
      { key: 'cancelledOrders', label: 'Cancelled' },
      { key: 'pendingOrders', label: 'Pending' },
      { key: 'revenue', label: 'Revenue (INR)' },
      { key: 'averageOrderValue', label: 'Avg Order Value (INR)' },
    ];
    const csv = toCsv(columns, result.breakdowns.services);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${reportCsvFilename('services')}"`);
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

async function supportTickets(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getSupportAnalytics(ctx);
    return respond(res, result, ctx);
  } catch (err) { next(err); }
}

async function tasks(req, res, next) {
  try {
    const ctx = scopeAndRange(req);
    const result = await reportsService.getTaskAnalytics(ctx);
    return respond(res, result, ctx);
  } catch (err) { next(err); }
}

module.exports = {
  overview,
  orders,
  revenue,
  services,
  clients,
  admins,
  kyc,
  payments,
  communications,
  funnel,
  supportTickets,
  tasks,
  exportOrders,
  exportRevenue,
  exportServices,
};
