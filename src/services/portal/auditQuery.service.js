const { AuditLog, Order, Client } = require('../../models/portal');
const { ROLES } = require('../../constants/portal/roles');
const { buildOrderScopeFilter, buildClientScopeFilter } = require('../../middleware/portal/dataScope');

/**
 * Read-only, scoped audit log listing. Reuses the SAME data-scope engine
 * every other module uses (buildOrderScopeFilter/buildClientScopeFilter) -
 * no parallel scope system. Audit entries aren't all Order/Client-shaped
 * (e.g. ADMIN_CREATED on a User), so an Admin (never full ALL_DATA scope)
 * only ever sees: entries about an Order/Client within their own scope, or
 * entries where THEY were the actor. Super Admin (ALL_DATA scope) sees
 * everything, as intended.
 */
async function listAuditLogsForUser(user, { action, actor, resourceType, resourceId, dateFrom, dateTo, page = 1, limit = 20 } = {}) {
  const filter = {};
  if (action) {
    const actions = String(action).split(',').map((a) => a.trim()).filter(Boolean);
    filter.action = actions.length === 1 ? actions[0] : { $in: actions };
  }
  if (actor) filter.actor = actor;
  if (resourceType) filter.resourceType = resourceType;
  if (resourceId) filter.resourceId = resourceId;
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  if (user.role === ROLES.SUPER_ADMIN) {
    // Full access, per existing permission model.
  } else if (user.role === ROLES.ADMIN) {
    const orderScopeFilter = buildOrderScopeFilter(user);
    const clientScopeFilter = buildClientScopeFilter(user);
    const [scopedOrderIds, scopedClientIds] = await Promise.all([
      Order.find(orderScopeFilter).distinct('_id'),
      Client.find(clientScopeFilter).distinct('_id'),
    ]);

    const scopeOr = [
      { actor: user._id },
      { resourceType: 'Order', resourceId: { $in: scopedOrderIds } },
      { resourceType: 'Client', resourceId: { $in: scopedClientIds } },
    ];
    filter.$and = [{ $or: scopeOr }];
  } else {
    // Clients never reach this service - the route itself requires
    // VIEW_AUDIT_LOGS, which Clients are never granted (CLIENT_PERMISSIONS
    // has no admin-domain permissions at all). Fail closed regardless.
    return { items: [], meta: { page, limit, total: 0, totalPages: 1 } };
  }

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('actor', 'name email role'),
    AuditLog.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeAuditLog),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

function serializeAuditLog(log) {
  return {
    id: log._id,
    actor: log.actor ? { id: log.actor._id, name: log.actor.name, email: log.actor.email, role: log.actor.role } : null,
    actorRole: log.actorRole,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    metadata: log.metadata,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    createdAt: log.createdAt,
  };
}

module.exports = { listAuditLogsForUser, serializeAuditLog };
