const { Order, OrderAssignmentHistory } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { logAudit } = require('./auditLog.service');
// Reused, not duplicated: the same "is this a real, ACTIVE Admin" check
// Phase 3's Client assignment uses.
const { assertEligibleAdmin } = require('./clientAssignment.service');
const communicationService = require('./communication.service');
const notificationEventsService = require('./notificationEvents.service');

/**
 * The single source of truth for Admin<->Order assignment, mirroring
 * clientAssignment.service.js. `order` is always the already
 * scope-checked document (loaded via loadScoped in orders.routes.js) -
 * this function does not re-check data scope, only that the target Admin
 * is a real, ACTIVE Admin account.
 */
async function assignOrder({ order, adminId, actor, reason = null, meta = {} }) {
  const admin = await assertEligibleAdmin(adminId);

  const previousAdmin = order.assignedAdmin;
  if (previousAdmin && String(previousAdmin) === String(admin._id)) {
    return order; // already assigned to this admin - no-op
  }

  const isReassignment = !!previousAdmin;

  order.assignedAdmin = admin._id;
  order.assignedAt = new Date();
  order.updatedBy = actor._id;
  await order.save();

  await OrderAssignmentHistory.create({
    order: order._id,
    previousAdmin: previousAdmin || null,
    newAdmin: admin._id,
    action: isReassignment ? 'REASSIGNED' : 'ASSIGNED',
    changedBy: actor._id,
    reason,
  });

  await logAudit({
    actor: actor._id,
    actorRole: actor.role,
    action: isReassignment ? AUDIT_ACTIONS.ORDER_REASSIGNED : AUDIT_ACTIONS.ORDER_ASSIGNED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: {
      orderCode: order.orderCode,
      previousAdmin: previousAdmin ? String(previousAdmin) : null,
      newAdmin: String(admin._id),
      reason,
    },
    ...meta,
  });

  await communicationService.sendOrderAssigned(order, admin).catch(() => {});
  if (isReassignment) {
    await notificationEventsService.notifyOrderReassigned(order, admin, actor._id).catch(() => {});
  } else {
    await notificationEventsService.notifyOrderAssigned(order, admin, actor._id).catch(() => {});
  }

  return order;
}

async function unassignOrder({ order, actor, reason = null, meta = {} }) {
  if (!order.assignedAdmin) {
    throw AppError.badRequest('This order is not currently assigned to an admin.');
  }

  const previousAdmin = order.assignedAdmin;
  order.assignedAdmin = null;
  order.assignedAt = null;
  order.updatedBy = actor._id;
  await order.save();

  await OrderAssignmentHistory.create({
    order: order._id,
    previousAdmin,
    newAdmin: null,
    action: 'UNASSIGNED',
    changedBy: actor._id,
    reason,
  });

  await logAudit({
    actor: actor._id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.ORDER_UNASSIGNED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { orderCode: order.orderCode, previousAdmin: String(previousAdmin), reason },
    ...meta,
  });

  return order;
}

async function getAssignmentHistory(orderId, { page = 1, limit = 20 } = {}) {
  const filter = { order: orderId };
  const [items, total] = await Promise.all([
    OrderAssignmentHistory.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    OrderAssignmentHistory.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

module.exports = { assignOrder, unassignOrder, getAssignmentHistory };
