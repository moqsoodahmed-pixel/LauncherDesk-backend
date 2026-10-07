const { Client, Order, User, RefreshToken, Service, Payment, KycDocument, SupportTicket } = require('../../models/portal');
const { PAYMENT_ATTEMPT_STATUS } = require('../../constants/portal/paymentAttemptStatus');
const { paiseToRupees } = require('../../services/portal/money.service');
const { buildClientScopeFilter, buildOrderScopeFilter } = require('../../middleware/portal/dataScope');
const { sendSuccess } = require('../../utils/portal/apiResponse');
const { ORDER_STATUS } = require('../../constants/portal/orderStatus');
const { ORDER_PAYMENT_STATUS } = require('../../constants/portal/orderPaymentStatus');
const { ROLES } = require('../../constants/portal/roles');
const { USER_STATUS } = require('../../constants/portal/userStatus');
const { CLIENT_STATUS } = require('../../constants/portal/clientStatus');
const { SERVICE_STATUS } = require('../../constants/portal/serviceStatus');
const { KYC_DOCUMENT_STATUS } = require('../../constants/portal/kycStatus');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const { effectivePermissions, effectiveDataScope, hasPermission } = require('../../services/portal/authorization.service');

/**
 * Real (not faked) dashboard counts, computed with the same data-scope
 * filters the rest of the app uses, so Phase 0 already proves that an
 * Admin's dashboard only reflects their assigned data. Business-specific
 * cards (revenue, filters, drill-down) are deferred to Phase 11.
 */
async function superAdminDashboard(req, res, next) {
  try {
    const [
      totalClients,
      activeClients,
      inactiveClients,
      suspendedClients,
      pendingClients,
      archivedClients,
      unassignedClients,
      totalAdmins,
      activeAdmins,
      disabledAdmins,
      suspendedAdmins,
      pendingAdmins,
      totalOrders,
      createdOrders,
      paymentPendingOrders,
      paymentConfirmedOrders,
      assignedOrders,
      inProgressOrders,
      completedOrders,
      cancelledOrders,
      closedOrders,
    ] = await Promise.all([
      Client.countDocuments({}),
      Client.countDocuments({ status: CLIENT_STATUS.ACTIVE }),
      Client.countDocuments({ status: CLIENT_STATUS.INACTIVE }),
      Client.countDocuments({ status: CLIENT_STATUS.SUSPENDED }),
      Client.countDocuments({ status: CLIENT_STATUS.PENDING }),
      Client.countDocuments({ status: CLIENT_STATUS.ARCHIVED }),
      Client.countDocuments({ assignedAdmin: null, status: { $ne: CLIENT_STATUS.ARCHIVED } }),
      User.countDocuments({ role: ROLES.ADMIN }),
      User.countDocuments({ role: ROLES.ADMIN, status: USER_STATUS.ACTIVE }),
      User.countDocuments({ role: ROLES.ADMIN, status: USER_STATUS.DISABLED }),
      User.countDocuments({ role: ROLES.ADMIN, status: USER_STATUS.SUSPENDED }),
      User.countDocuments({ role: ROLES.ADMIN, status: USER_STATUS.PENDING }),
      Order.countDocuments({}),
      Order.countDocuments({ status: ORDER_STATUS.CREATED }),
      Order.countDocuments({ status: ORDER_STATUS.PAYMENT_PENDING }),
      Order.countDocuments({ status: ORDER_STATUS.PAYMENT_CONFIRMED }),
      Order.countDocuments({ status: ORDER_STATUS.ASSIGNED }),
      Order.countDocuments({ status: ORDER_STATUS.IN_PROGRESS }),
      Order.countDocuments({ status: ORDER_STATUS.COMPLETED }),
      Order.countDocuments({ status: ORDER_STATUS.CANCELLED }),
      Order.countDocuments({ status: ORDER_STATUS.CLOSED }),
    ]);

    // Date boundaries for time-scoped stats
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(todayStart.getDate() - todayStart.getDay()); // Sunday
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [totalOrderValueAgg] = await Order.aggregate([
      { $match: { status: { $ne: ORDER_STATUS.CANCELLED } } },
      { $group: { _id: null, totalMinor: { $sum: '$pricing.totalAmountMinor' } } },
    ]);
    const totalOrderValue = (totalOrderValueAgg?.totalMinor || 0) / 100;

    // Time-scoped order counts
    const [todayOrders, weekOrders, monthOrders] = await Promise.all([
      Order.countDocuments({ createdAt: { $gte: todayStart } }),
      Order.countDocuments({ createdAt: { $gte: weekStart } }),
      Order.countDocuments({ createdAt: { $gte: monthStart } }),
    ]);

    const adminIdsWithSessions = await RefreshToken.distinct('user', {
      revoked: false,
      expiresAt: { $gt: new Date() },
      user: { $in: await User.find({ role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] } }).distinct('_id') },
    });

    const [totalServices, activeServices, inactiveServices, completedServices, archivedServices, kycEnabledServices, publicServices] = await Promise.all([
      Service.countDocuments({}),
      Service.countDocuments({ status: SERVICE_STATUS.ACTIVE }),
      Service.countDocuments({ status: SERVICE_STATUS.INACTIVE }),
      Service.countDocuments({ status: SERVICE_STATUS.COMPLETED }),
      Service.countDocuments({ status: SERVICE_STATUS.ARCHIVED }),
      Service.countDocuments({ requiresKyc: true }),
      Service.countDocuments({ isPublic: true }),
    ]);

    // Payment aggregations — all time + time-scoped
    const [
      paidAgg,
      refundedAgg,
      paymentPendingValueAgg,
      todayRevenueAgg,
      weekRevenueAgg,
      monthRevenueAgg,
      yearRevenueAgg,
      gstAgg,
      successfulPayments,
      failedPayments,
      refundedPayments,
    ] = await Promise.all([
      Payment.aggregate([{ $match: { status: PAYMENT_ATTEMPT_STATUS.CONFIRMED } }, { $group: { _id: null, total: { $sum: '$amountPaise' } } }]),
      Payment.aggregate([{ $match: { status: PAYMENT_ATTEMPT_STATUS.REFUNDED } }, { $group: { _id: null, total: { $sum: '$refundAmountPaise' } } }]),
      Order.aggregate([{ $match: { paymentStatus: ORDER_PAYMENT_STATUS.PENDING } }, { $group: { _id: null, totalMinor: { $sum: '$pricing.totalAmountMinor' } } }]),
      Payment.aggregate([{ $match: { status: PAYMENT_ATTEMPT_STATUS.CONFIRMED, paidAt: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: '$amountPaise' } } }]),
      Payment.aggregate([{ $match: { status: PAYMENT_ATTEMPT_STATUS.CONFIRMED, paidAt: { $gte: weekStart } } }, { $group: { _id: null, total: { $sum: '$amountPaise' } } }]),
      Payment.aggregate([{ $match: { status: PAYMENT_ATTEMPT_STATUS.CONFIRMED, paidAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: '$amountPaise' } } }]),
      Payment.aggregate([{ $match: { status: PAYMENT_ATTEMPT_STATUS.CONFIRMED, paidAt: { $gte: yearStart } } }, { $group: { _id: null, total: { $sum: '$amountPaise' } } }]),
      Order.aggregate([{ $match: { paymentStatus: ORDER_PAYMENT_STATUS.CONFIRMED } }, { $group: { _id: null, gst: { $sum: '$pricing.gstAmountMinor' } } }]),
      Payment.countDocuments({ status: PAYMENT_ATTEMPT_STATUS.CONFIRMED }),
      Payment.countDocuments({ status: PAYMENT_ATTEMPT_STATUS.FAILED }),
      Payment.countDocuments({ status: PAYMENT_ATTEMPT_STATUS.REFUNDED }),
    ]);

    const revenue = paiseToRupees(paidAgg[0]?.total || 0);
    const refundedAmount = paiseToRupees(refundedAgg[0]?.total || 0);
    const paymentPendingValue = paiseToRupees(paymentPendingValueAgg[0]?.totalMinor || 0);
    const todayRevenue = paiseToRupees(todayRevenueAgg[0]?.total || 0);
    const weeklyRevenue = paiseToRupees(weekRevenueAgg[0]?.total || 0);
    const monthlyRevenue = paiseToRupees(monthRevenueAgg[0]?.total || 0);
    const yearlyRevenue = paiseToRupees(yearRevenueAgg[0]?.total || 0);
    const gstCollected = paiseToRupees(gstAgg[0]?.gst || 0);
    const netRevenue = Math.max(0, revenue - refundedAmount);
    const avgTransactionValue = successfulPayments > 0 ? revenue / successfulPayments : 0;

    const [mrrAgg, gstMonthAgg] = await Promise.all([
      Payment.aggregate([
        { $match: { status: PAYMENT_ATTEMPT_STATUS.CONFIRMED, paidAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$amountPaise' } } },
      ]),
      Order.aggregate([
        { $match: { paymentStatus: ORDER_PAYMENT_STATUS.CONFIRMED, updatedAt: { $gte: monthStart } } },
        { $group: { _id: null, gst: { $sum: '$pricing.gstAmountMinor' } } },
      ]),
    ]);
    const mrr = (mrrAgg[0]?.total || 0) / 100;
    const arr = Math.round(mrr * 12);
    const gstCollectedMonth = (gstMonthAgg[0]?.gst || 0) / 100;

    const [kycPending, kycSubmitted, kycUnderVerification, kycRejected, kycDeletionPending, kycVerified] = await Promise.all([
      Order.countDocuments({ status: ORDER_STATUS.KYC_PENDING }),
      Order.countDocuments({ status: ORDER_STATUS.KYC_SUBMITTED }),
      Order.countDocuments({ status: ORDER_STATUS.KYC_VERIFICATION }),
      Order.countDocuments({ status: ORDER_STATUS.KYC_REJECTED }),
      Order.countDocuments({ status: ORDER_STATUS.KYC_DELETION_PENDING }),
      KycDocument.countDocuments({ status: KYC_DOCUMENT_STATUS.VERIFIED }),
    ]);

    // Support tickets + workflow task stats + recent activity
    const { Task, SupportTicket, AuditLog } = require('../../models/portal');
    const { getWorkflowStats } = require('../../services/portal/task.service');
    const { getTicketStats } = require('../../services/portal/supportTicket.service');

    const [workflowStats, ticketStats, recentActivity] = await Promise.all([
      getWorkflowStats().catch(() => null),
      getTicketStats().catch(() => null),
      AuditLog.find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .select('action actor resourceType resourceId createdAt metadata')
        .populate('actor', 'name role'),
    ]);

    return sendSuccess(res, {
      message: 'Super Admin dashboard.',
      data: {
        // Services
        totalServices, activeServices, inactiveServices, completedServices, archivedServices, kycEnabledServices, publicServices,
        // Clients
        totalClients, activeClients, inactiveClients, suspendedClients, pendingClients, archivedClients, unassignedClients,
        // Admins
        totalAdmins, activeAdmins, disabledAdmins, suspendedAdmins, pendingAdmins,
        adminsWithActiveSessions: adminIdsWithSessions.length,
        // Orders
        totalOrders, todayOrders, weekOrders, monthOrders,
        createdOrders, paymentPendingOrders, paymentConfirmedOrders,
        assignedOrders, inProgressOrders, completedOrders, cancelledOrders, closedOrders,
        totalOrderValue,
        // Payments / Revenue
        revenue, todayRevenue, weeklyRevenue, monthlyRevenue, yearlyRevenue,
        paymentPendingValue, refundedAmount, gstCollected, netRevenue, avgTransactionValue,
        successfulPayments, failedPayments, refundedPayments,
        mrr, arr, gstCollectedMonth,
        // KYC
        kycPending, kycSubmitted, kycUnderVerification, kycRejected, kycDeletionPending, kycVerified,
        // Workflow
        workflowStats,
        // Support tickets
        ticketStats,
        // Recent activity
        recentActivity: recentActivity.map((a) => ({
          action: a.action,
          resourceType: a.resourceType,
          resourceId: a.resourceId,
          actorName: a.actor?.name || 'System',
          actorRole: a.actor?.role || null,
          createdAt: a.createdAt,
        })),
        // Meta
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function adminDashboard(req, res, next) {
  try {
    const { Task, AuditLog } = require('../../models/portal');

    const clientFilter = buildClientScopeFilter(req.user);
    const orderFilter = buildOrderScopeFilter(req.user);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000 - 1);

    const [myClients, activeClients, pendingClients, suspendedClients, myOrders, inProgressOrders, completedOrders] =
      await Promise.all([
        Client.countDocuments(clientFilter),
        Client.countDocuments({ ...clientFilter, status: CLIENT_STATUS.ACTIVE }),
        Client.countDocuments({ ...clientFilter, status: CLIENT_STATUS.PENDING }),
        Client.countDocuments({ ...clientFilter, status: CLIENT_STATUS.SUSPENDED }),
        Order.countDocuments(orderFilter),
        Order.countDocuments({ ...orderFilter, status: ORDER_STATUS.IN_PROGRESS }),
        Order.countDocuments({ ...orderFilter, status: ORDER_STATUS.COMPLETED }),
      ]);

    const [pendingOrders, cancelledOrders, ordersDueToday] = await Promise.all([
      Order.countDocuments({
        ...orderFilter,
        status: { $in: [ORDER_STATUS.CREATED, ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.PAYMENT_CONFIRMED, ORDER_STATUS.ASSIGNED] },
      }),
      Order.countDocuments({ ...orderFilter, status: ORDER_STATUS.CANCELLED }),
      Order.countDocuments({ ...orderFilter, dueDate: { $gte: todayStart, $lte: todayEnd } }),
    ]);

    // KYC counts — scoped via KycDocument -> order -> assignedAdmin
    const assignedOrderIds = await Order.find(orderFilter).distinct('_id');
    const [kycPendingCount, kycUnderReviewCount, kycRejectedCount] = await Promise.all([
      KycDocument.countDocuments({ order: { $in: assignedOrderIds }, status: KYC_DOCUMENT_STATUS.UPLOADED }),
      KycDocument.countDocuments({ order: { $in: assignedOrderIds }, status: 'UNDER_REVIEW' }),
      KycDocument.countDocuments({ order: { $in: assignedOrderIds }, status: KYC_DOCUMENT_STATUS.REJECTED }),
    ]);

    // Task counts — scoped to this admin
    const taskFilter = { assignedTo: req.user._id };
    const [taskPending, taskInProgress, taskOverdue, taskCompletedToday] = await Promise.all([
      Task.countDocuments({ ...taskFilter, status: 'PENDING' }),
      Task.countDocuments({ ...taskFilter, status: 'IN_PROGRESS' }),
      Task.countDocuments({ ...taskFilter, status: { $nin: ['COMPLETED', 'CANCELLED'] }, dueDate: { $lt: now } }),
      Task.countDocuments({ ...taskFilter, status: 'COMPLETED', updatedAt: { $gte: todayStart } }),
    ]);

    // Support ticket counts — scoped to this admin
    const ticketFilter = { assignedTo: req.user._id };
    const [supportOpen, supportInProgress, supportResolved] = await Promise.all([
      SupportTicket.countDocuments({ ...ticketFilter, status: 'OPEN' }),
      SupportTicket.countDocuments({ ...ticketFilter, status: 'IN_PROGRESS' }),
      SupportTicket.countDocuments({ ...ticketFilter, status: 'RESOLVED' }),
    ]);

    // SLA breaches — orders past dueDate still in active statuses
    const slaBreached = await Order.countDocuments({
      ...orderFilter,
      status: { $in: [ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.ASSIGNED, ORDER_STATUS.KYC_VERIFICATION] },
      dueDate: { $lt: now },
    });

    // Recent activity — audit log entries for this admin's resources
    const recentActivity = await AuditLog.find({ 'actor': req.user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('action resourceType resourceId createdAt metadata');

    let serviceMetrics;
    if (hasPermission(req.user, PERMISSIONS.VIEW_SERVICE)) {
      const [totalServices, activeServices] = await Promise.all([
        Service.countDocuments({}),
        Service.countDocuments({ status: SERVICE_STATUS.ACTIVE }),
      ]);
      serviceMetrics = { totalServices, activeServices };
    }

    return sendSuccess(res, {
      message: 'Admin dashboard.',
      data: {
        // Clients
        myClients, activeClients, pendingClients, suspendedClients,
        // Orders
        myOrders, inProgressOrders, completedOrders, pendingOrders, cancelledOrders,
        ordersDueToday,
        // KYC
        kycPendingCount, kycUnderReviewCount, kycRejectedCount,
        // Tasks
        taskPending, taskInProgress, taskOverdue, taskCompletedToday,
        // Support
        supportOpen, supportInProgress, supportResolved,
        // SLA
        slaBreached,
        // Services
        services: serviceMetrics ?? null,
        // Activity
        recentActivity: recentActivity.map((a) => ({
          action: a.action,
          resourceType: a.resourceType,
          resourceId: a.resourceId,
          createdAt: a.createdAt,
        })),
        permissions: effectivePermissions(req.user),
        dataScope: effectiveDataScope(req.user),
        status: req.user.status,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function clientDashboard(req, res, next) {
  try {
    if (!req.user.clientProfile) {
      return sendSuccess(res, {
        message: 'Client dashboard.',
        data: { myOrders: 0, note: 'No linked client profile yet.' },
      });
    }

    const { AuditLog } = require('../../models/portal');
    const { serializeOrderForClient } = require('../../services/portal/orders.service');
    const orderFilter = { client: req.user.clientProfile };
    const [client, myOrders, activeOrders, completedOrders, pendingPaymentOrders, cancelledOrders, recentActivity, recentOrders, openTickets, kycPending, kycRejected] =
      await Promise.all([
        Client.findById(req.user.clientProfile).populate('assignedAdmin', 'name email adminCode'),
        Order.countDocuments(orderFilter),
        Order.countDocuments({ ...orderFilter, status: { $nin: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED, ORDER_STATUS.CANCELLED] } }),
        Order.countDocuments({ ...orderFilter, status: { $in: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CLOSED] } }),
        Order.countDocuments({ ...orderFilter, paymentStatus: ORDER_PAYMENT_STATUS.PENDING }),
        Order.countDocuments({ ...orderFilter, status: ORDER_STATUS.CANCELLED }),
        AuditLog.find({ resourceType: 'Client', resourceId: req.user.clientProfile })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('action createdAt'),
        Order.find(orderFilter).sort({ createdAt: -1 }).limit(5),
        SupportTicket.countDocuments({ client: req.user.clientProfile, status: { $in: ['OPEN', 'WAITING'] } }),
        KycDocument.countDocuments({ client: req.user.clientProfile, status: { $in: [KYC_DOCUMENT_STATUS.UPLOADED, KYC_DOCUMENT_STATUS.UNDER_REVIEW] } }),
        KycDocument.countDocuments({ client: req.user.clientProfile, status: KYC_DOCUMENT_STATUS.REJECTED }),
      ]);

    // Phase 11: a small, client-own-data-only spending summary - never
    // company-wide revenue, never other clients, computed from the same
    // Payment model the internal reports use (reused, not re-derived).
    const ownOrderIds = await Order.find(orderFilter).distinct('_id');
    const [paidAgg] = await Payment.aggregate([
      { $match: { order: { $in: ownOrderIds }, status: PAYMENT_ATTEMPT_STATUS.CONFIRMED } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);
    const totalPaidAmount = paiseToRupees(paidAgg?.total || 0);

    return sendSuccess(res, {
      message: 'Client dashboard.',
      data: {
        totalPaidAmount,
        clientCode: client?.clientCode ?? null,
        status: client?.status ?? null,
        assignedAdmin: client?.assignedAdmin ? {
          name: client.assignedAdmin.name,
          email: client.assignedAdmin.email,
          adminCode: client.assignedAdmin.adminCode || null,
        } : null,
        recentActivity: recentActivity.map((a) => ({ action: a.action, createdAt: a.createdAt })),
        myOrders,
        totalOrders: myOrders,
        activeOrders,
        completedOrders,
        pendingPaymentOrders,
        cancelledOrders,
        openTickets,
        kycPending,
        kycRejected,
        recentOrders: recentOrders.map(serializeOrderForClient),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { superAdminDashboard, adminDashboard, clientDashboard };
