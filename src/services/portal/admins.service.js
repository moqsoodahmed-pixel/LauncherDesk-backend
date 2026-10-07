const { User, Client, RefreshToken, AuditLog, Order, Payment, KycDocument } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { ROLES } = require('../../constants/portal/roles');
const { USER_STATUS } = require('../../constants/portal/userStatus');
const { DATA_SCOPES, DEFAULT_ADMIN_DATA_SCOPE } = require('../../constants/portal/dataScopes');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { hashPassword } = require('./password.service');
const { generateAdminCode } = require('./idGenerator.service');
const tokenService = require('./token.service');
const { logAudit } = require('./auditLog.service');
const { effectivePermissions, effectiveDataScope } = require('./authorization.service');
const authService = require('./auth.service');
const clientAssignment = require('./clientAssignment.service');
const notificationEventsService = require('./notificationEvents.service');

const MANAGEABLE_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

/** Whitelist-based shape for any admin/staff record leaving this service. */
function serializeAdmin(user, extra = {}) {
  return {
    id: user._id,
    adminCode: user.adminCode ?? null,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    department: user.department ?? null,
    role: user.role,
    status: user.status,
    permissions: effectivePermissions(user),
    dataScope: effectiveDataScope(user),
    assignedClientsCount: extra.assignedClientsCount ?? undefined,
    lastLogin: user.lastLogin ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    createdBy: user.createdBy ?? null,
  };
}

function auditCtx(actor) {
  return { actor: actor._id, actorRole: actor.role };
}

/** Loads a staff (ADMIN/SUPER_ADMIN) user by id. 404s for anything else, including a valid id belonging to a CLIENT - no existence oracle. */
async function findManagedUserOrThrow(id) {
  const user = await User.findById(id).select('+passwordHash');
  if (!user || !MANAGEABLE_ROLES.includes(user.role)) {
    throw AppError.notFound('Admin not found.');
  }
  return user;
}

async function countActiveSuperAdmins(excludeId = null) {
  const filter = { role: ROLES.SUPER_ADMIN, status: USER_STATUS.ACTIVE };
  if (excludeId) filter._id = { $ne: excludeId };
  return User.countDocuments(filter);
}

/**
 * Throws if applying `changes` (role and/or status moving away from
 * SUPER_ADMIN/ACTIVE) to `user` would leave zero active Super Admins.
 */
async function assertNotLastSuperAdmin(user, changes) {
  const wasActiveSuperAdmin = user.role === ROLES.SUPER_ADMIN && user.status === USER_STATUS.ACTIVE;
  if (!wasActiveSuperAdmin) return;

  const nextRole = changes.role ?? user.role;
  const nextStatus = changes.status ?? user.status;
  const staysActiveSuperAdmin = nextRole === ROLES.SUPER_ADMIN && nextStatus === USER_STATUS.ACTIVE;
  if (staysActiveSuperAdmin) return;

  const remaining = await countActiveSuperAdmins(user._id);
  if (remaining === 0) {
    throw AppError.lastSuperAdmin();
  }
}

function buildListFilter({ search, status, role, department, dataScope, dateFrom, dateTo }) {
  const filter = { role: { $in: MANAGEABLE_ROLES } };
  if (status) filter.status = status;
  if (role) filter.role = role;
  if (department) filter.department = department;
  if (dataScope) {
    filter.$or = [{ 'dataScope.clients': dataScope }, { 'dataScope.orders': dataScope }];
  }
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }
  if (search) {
    const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$and = (filter.$and || []).concat([{ $or: [{ name: re }, { email: re }, { adminCode: re }, { legacyAdminCode: re }, { legacyCode: re }] }]);
  }
  return filter;
}

async function listAdmins({ page = 1, limit = 20, sortBy = 'createdAt', sortDir = 'desc', ...filters }) {
  const filter = buildListFilter(filters);
  const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };

  const [items, total] = await Promise.all([
    User.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  const counts = await Client.aggregate([
    { $match: { assignedAdmin: { $in: items.map((u) => u._id) } } },
    { $group: { _id: '$assignedAdmin', count: { $sum: 1 } } },
  ]);
  const countByAdmin = new Map(counts.map((c) => [String(c._id), c.count]));

  return {
    items: items.map((u) => serializeAdmin(u, { assignedClientsCount: countByAdmin.get(String(u._id)) || 0 })),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function getAdminById(id) {
  const user = await findManagedUserOrThrow(id);
  const assignedClientsCount = await Client.countDocuments({ assignedAdmin: user._id });
  return serializeAdmin(user, { assignedClientsCount });
}

async function createAdmin(payload, actor, meta = {}) {
  const email = String(payload.email).toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (existing) {
    throw AppError.conflict('An account with this email already exists.');
  }

  const role = payload.role || ROLES.ADMIN;
  if (role === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
    // Unreachable today (route is Super-Admin-only) - defence in depth
    // against a future relaxation of the role guard on this route.
    throw AppError.forbidden('Only a Super Admin can create another Super Admin.');
  }

  const adminCode = await generateAdminCode();

  const user = await User.create({
    name: payload.name,
    email,
    phone: payload.phone ?? null,
    department: payload.department ?? null,
    passwordHash: await hashPassword(payload.password),
    role,
    status: payload.status || USER_STATUS.ACTIVE,
    adminCode,
    // A brand-new Admin starts with nothing until the Super Admin grants
    // permissions explicitly - never inherits a default set implicitly.
    permissions: role === ROLES.ADMIN ? payload.permissions || [] : [],
    dataScope:
      role === ROLES.ADMIN
        ? {
            clients: payload.dataScope?.clients || DEFAULT_ADMIN_DATA_SCOPE.clients,
            orders: payload.dataScope?.orders || DEFAULT_ADMIN_DATA_SCOPE.orders,
          }
        : undefined,
    createdBy: actor._id,
  });

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ADMIN_CREATED,
    resourceType: 'User',
    resourceId: user._id,
    metadata: { email: user.email, role: user.role },
    ...meta,
  });
  await notificationEventsService.notifyAdminCreated(user).catch(() => {});

  return serializeAdmin(user, { assignedClientsCount: 0 });
}

async function updateAdmin(id, changes, actor, meta = {}) {
  const user = await findManagedUserOrThrow(id);

  if (changes.role && changes.role !== user.role) {
    if (changes.role === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
      throw AppError.forbidden('Only a Super Admin can promote an account to Super Admin.');
    }
    await assertNotLastSuperAdmin(user, { role: changes.role });
  }
  if (changes.status && changes.status !== user.status) {
    await assertNotLastSuperAdmin(user, { status: changes.status });
  }

  const roleChanged = changes.role && changes.role !== user.role;
  const previousRole = user.role;

  for (const field of ['name', 'phone', 'department', 'role', 'status']) {
    if (changes[field] !== undefined) user[field] = changes[field];
  }
  // Downgrading out of ADMIN-specific fields, or newly becoming an ADMIN,
  // keeps permissions/scope consistent with the role rather than carrying
  // stale admin permissions onto a Super Admin record (where they are
  // ignored) or leaving them unset on a freshly demoted Admin.
  if (roleChanged && user.role !== ROLES.ADMIN) {
    user.permissions = [];
  }
  if (roleChanged && user.role === ROLES.ADMIN && previousRole !== ROLES.ADMIN) {
    user.dataScope = { ...DEFAULT_ADMIN_DATA_SCOPE };
  }

  await user.save();

  if (roleChanged) {
    const revoked = previousRole === ROLES.SUPER_ADMIN || user.role === ROLES.SUPER_ADMIN;
    await logAudit({
      ...auditCtx(actor),
      action: AUDIT_ACTIONS.ADMIN_ROLE_CHANGED,
      resourceType: 'User',
      resourceId: user._id,
      metadata: { from: previousRole, to: user.role },
      ...meta,
    });
    if (revoked) {
      // A role change touching SUPER_ADMIN re-derives the access token's
      // `role` claim on next use - force re-authentication immediately.
      await tokenService.revokeAllUserTokens(user._id);
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save();
    }
  }

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ADMIN_UPDATED,
    resourceType: 'User',
    resourceId: user._id,
    metadata: { fields: Object.keys(changes) },
    ...meta,
  });

  const assignedClientsCount = await Client.countDocuments({ assignedAdmin: user._id });
  return serializeAdmin(user, { assignedClientsCount });
}

const STATUS_AUDIT_ACTION = {
  [USER_STATUS.ACTIVE]: AUDIT_ACTIONS.ADMIN_ENABLED,
  [USER_STATUS.DISABLED]: AUDIT_ACTIONS.ADMIN_DISABLED,
  [USER_STATUS.SUSPENDED]: AUDIT_ACTIONS.ADMIN_SUSPENDED,
  [USER_STATUS.PENDING]: AUDIT_ACTIONS.ADMIN_UPDATED,
};

async function updateStatus(id, status, actor, meta = {}) {
  const user = await findManagedUserOrThrow(id);

  if (status !== user.status) {
    await assertNotLastSuperAdmin(user, { status });
  }

  const previousStatus = user.status;
  user.status = status;

  // Leaving ACTIVE must take effect immediately, not at next token expiry.
  if (status !== USER_STATUS.ACTIVE) {
    await tokenService.revokeAllUserTokens(user._id);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
  }
  await user.save();

  await logAudit({
    ...auditCtx(actor),
    action: STATUS_AUDIT_ACTION[status] || AUDIT_ACTIONS.ADMIN_UPDATED,
    resourceType: 'User',
    resourceId: user._id,
    metadata: { from: previousStatus, to: status },
    ...meta,
  });
  await notificationEventsService.notifyAdminStatusChanged(user, status).catch(() => {});

  const assignedClientsCount = await Client.countDocuments({ assignedAdmin: user._id });
  return serializeAdmin(user, { assignedClientsCount });
}

async function getPermissions(id) {
  const user = await findManagedUserOrThrow(id);
  return { permissions: effectivePermissions(user), role: user.role };
}

async function updatePermissions(id, permissions, actor, meta = {}) {
  const user = await findManagedUserOrThrow(id);
  if (user.role === ROLES.SUPER_ADMIN) {
    throw AppError.badRequest('Super Admin always holds every permission implicitly; explicit permissions are not applicable.');
  }

  const before = [...(user.permissions || [])];
  user.permissions = [...new Set(permissions)];
  await user.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ADMIN_PERMISSIONS_CHANGED,
    resourceType: 'User',
    resourceId: user._id,
    metadata: { before, after: user.permissions },
    ...meta,
  });

  return { permissions: effectivePermissions(user) };
}

async function updateScope(id, dataScope, actor, meta = {}) {
  const user = await findManagedUserOrThrow(id);
  if (user.role === ROLES.SUPER_ADMIN) {
    throw AppError.badRequest('Super Admin always has unrestricted data scope; explicit scope is not applicable.');
  }

  const before = { ...user.dataScope };
  user.dataScope = { clients: dataScope.clients, orders: dataScope.orders };
  await user.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ADMIN_SCOPE_CHANGED,
    resourceType: 'User',
    resourceId: user._id,
    metadata: { before, after: user.dataScope },
    ...meta,
  });

  return { dataScope: effectiveDataScope(user) };
}

/**
 * Super Admin forces a password reset on an Admin.
 *   SET_PASSWORD - immediately sets the given password (never echoed back).
 *   EMAIL_LINK   - reuses the existing self-service reset-email flow.
 * Either way every existing session for that admin is revoked.
 */
async function resetPassword(id, { mode = 'SET_PASSWORD', newPassword }, actor, meta = {}) {
  const user = await findManagedUserOrThrow(id);

  if (mode === 'EMAIL_LINK') {
    await authService.requestPasswordReset({ email: user.email, ...meta });
  } else {
    user.passwordHash = await hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await user.save();
  }

  await tokenService.revokeAllUserTokens(user._id);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ADMIN_PASSWORD_RESET,
    resourceType: 'User',
    resourceId: user._id,
    metadata: { mode },
    ...meta,
  });
}

/** One row per live session (a session may have several rotated-token rows; only the newest, unrevoked one represents it). */
async function getSessions(id) {
  await findManagedUserOrThrow(id);
  const rows = await RefreshToken.find({ user: id, revoked: false }).sort({ createdAt: -1 });
  return rows.map((r) => ({
    sessionId: r.sessionId,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    issuedAt: r.issuedAt,
    expiresAt: r.expiresAt,
  }));
}

async function revokeSessions(id, actor, meta = {}) {
  const user = await findManagedUserOrThrow(id);
  await tokenService.revokeAllUserTokens(user._id);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.ADMIN_SESSIONS_REVOKED,
    resourceType: 'User',
    resourceId: user._id,
    ...meta,
  });
}

async function getActivity(id, { page = 1, limit = 20 } = {}) {
  await findManagedUserOrThrow(id);
  const filter = { $or: [{ actor: id }, { resourceType: 'User', resourceId: id }] };
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

function serializeClient(client) {
  return {
    id: client._id,
    clientCode: client.clientCode,
    name: client.name,
    companyName: client.companyName,
    email: client.email,
    status: client.status,
    assignedAt: client.assignedAt,
  };
}

async function listAdminClients(id, { page = 1, limit = 20 } = {}) {
  await findManagedUserOrThrow(id);
  const filter = { assignedAdmin: id };
  const [items, total] = await Promise.all([
    Client.find(filter)
      .sort({ assignedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Client.countDocuments(filter),
  ]);
  return { items: items.map(serializeClient), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

// Assignment logic itself lives in clientAssignment.service.js (the single
// source of truth shared with clients.service.js) - these are thin
// admin-centric wrappers kept for the /api/admins/:id/clients routes.
async function assignClient(id, clientId, actor, meta = {}) {
  await findManagedUserOrThrow(id); // 404s if `id` isn't a staff account at all
  const client = await clientAssignment.assignClient({ clientId, adminId: id, actor, meta });
  return serializeClient(client);
}

async function bulkAssignClients(id, clientIds, actor, meta = {}) {
  await findManagedUserOrThrow(id);
  const results = [];
  for (const clientId of clientIds) {
    results.push(serializeClient(await clientAssignment.assignClient({ clientId, adminId: id, actor, meta })));
  }
  return results;
}

async function unassignClient(id, clientId, actor, meta = {}) {
  const admin = await findManagedUserOrThrow(id);
  const client = await Client.findOne({ _id: clientId, assignedAdmin: admin._id });
  if (!client) {
    throw AppError.notFound('Client is not assigned to this admin.');
  }
  await clientAssignment.unassignClient({ clientId, actor, meta });
  return { unassigned: true };
}

async function getAdminStats(id) {
  const admin = await findManagedUserOrThrow(id);
  const adminObjId = admin._id;

  const [orderStatusCounts, kycPending, orderIds, assignedClientCount] = await Promise.all([
    Order.aggregate([
      { $match: { assignedAdmin: adminObjId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    KycDocument.countDocuments({ status: { $in: ['UPLOADED', 'UNDER_REVIEW'] } }),
    Order.distinct('_id', { assignedAdmin: adminObjId }),
    Client.countDocuments({ assignedAdmin: adminObjId }),
  ]);

  const confirmedPayments = await Payment.aggregate([
    { $match: { order: { $in: orderIds }, status: 'CONFIRMED' } },
    { $group: { _id: null, totalPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
  ]);

  const statusMap = {};
  for (const row of orderStatusCounts) {
    statusMap[row._id] = row.count;
  }

  const revenue = confirmedPayments[0] ? confirmedPayments[0].totalPaise / 100 : 0;
  const paymentsCount = confirmedPayments[0] ? confirmedPayments[0].count : 0;

  return {
    ordersByStatus: statusMap,
    totalOrders: Object.values(statusMap).reduce((a, b) => a + b, 0),
    kycPendingReview: kycPending,
    revenueRupees: revenue,
    confirmedPayments: paymentsCount,
    assignedClients: assignedClientCount,
  };
}

module.exports = {
  MANAGEABLE_ROLES,
  serializeAdmin,
  listAdmins,
  getAdminById,
  createAdmin,
  updateAdmin,
  updateStatus,
  getPermissions,
  updatePermissions,
  updateScope,
  resetPassword,
  getSessions,
  revokeSessions,
  getActivity,
  listAdminClients,
  assignClient,
  bulkAssignClients,
  unassignClient,
  getAdminStats,
};
