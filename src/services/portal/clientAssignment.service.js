const { Client, User, ClientAssignmentHistory } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { ROLES } = require('../../constants/portal/roles');
const { USER_STATUS } = require('../../constants/portal/userStatus');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { logAudit } = require('./auditLog.service');

/**
 * The SINGLE source of truth for Admin<->Client assignment. Both
 * admins.service.js (POST /api/admins/:id/clients, Phase 2) and
 * clients.service.js (POST /api/clients/:id/assign, Phase 3) call these
 * functions rather than touching `Client.assignedAdmin` directly, so there
 * is exactly one place that validates the target Admin and writes history.
 */

async function assertEligibleAdmin(adminId) {
  const admin = await User.findById(adminId);
  if (!admin || admin.role !== ROLES.ADMIN) {
    throw AppError.badRequest('Clients can only be assigned to an active Admin account.');
  }
  if (admin.status !== USER_STATUS.ACTIVE) {
    throw AppError.badRequest('Cannot assign a client to an Admin who is not ACTIVE.');
  }
  return admin;
}

async function loadClientOrThrow(clientId) {
  const client = await Client.findById(clientId);
  if (!client) {
    throw AppError.notFound('Client not found.');
  }
  return client;
}

/** Assigns (or reassigns, if already assigned elsewhere) a client to an Admin. */
async function assignClient({ clientId, adminId, actor, reason = null, meta = {} }) {
  const client = await loadClientOrThrow(clientId);
  const admin = await assertEligibleAdmin(adminId);

  const previousAdmin = client.assignedAdmin;
  const isReassignment = previousAdmin && String(previousAdmin) !== String(admin._id);

  if (previousAdmin && String(previousAdmin) === String(admin._id)) {
    return client; // already assigned to this admin - no-op, not an error
  }

  client.assignedAdmin = admin._id;
  client.assignedAt = new Date();
  await client.save();

  const action = isReassignment ? 'REASSIGNED' : 'ASSIGNED';
  await ClientAssignmentHistory.create({
    client: client._id,
    previousAdmin: previousAdmin || null,
    newAdmin: admin._id,
    action,
    actor: actor._id,
    reason,
  });

  await logAudit({
    actor: actor._id,
    actorRole: actor.role,
    action: isReassignment ? AUDIT_ACTIONS.CLIENT_REASSIGNED : AUDIT_ACTIONS.CLIENT_ASSIGNED,
    resourceType: 'Client',
    resourceId: client._id,
    metadata: {
      clientId: String(client._id),
      previousAdmin: previousAdmin ? String(previousAdmin) : null,
      newAdmin: String(admin._id),
      reason,
    },
    ...meta,
  });

  // So the assign/reassign response itself carries the admin's name immediately,
  // not just a later re-fetch of the client.
  await client.populate('assignedAdmin', 'name adminCode');
  return client;
}

async function unassignClient({ clientId, actor, reason = null, meta = {} }) {
  const client = await loadClientOrThrow(clientId);

  if (!client.assignedAdmin) {
    throw AppError.badRequest('This client is not currently assigned to an admin.');
  }

  const previousAdmin = client.assignedAdmin;
  client.assignedAdmin = null;
  client.assignedAt = null;
  await client.save();

  await ClientAssignmentHistory.create({
    client: client._id,
    previousAdmin,
    newAdmin: null,
    action: 'UNASSIGNED',
    actor: actor._id,
    reason,
  });

  await logAudit({
    actor: actor._id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.CLIENT_UNASSIGNED,
    resourceType: 'Client',
    resourceId: client._id,
    metadata: { clientId: String(client._id), previousAdmin: String(previousAdmin), reason },
    ...meta,
  });

  return client;
}

function serializeHistoryEntry(entry) {
  const nameOf = (admin) => (admin && admin.name ? `${admin.name}${admin.adminCode ? ` (${admin.adminCode})` : ''}` : null);
  return {
    _id: entry._id,
    action: entry.action,
    previousAdmin: nameOf(entry.previousAdmin),
    newAdmin: nameOf(entry.newAdmin),
    reason: entry.reason ?? null,
    createdAt: entry.createdAt,
  };
}

async function getAssignmentHistory(clientId, { page = 1, limit = 20 } = {}) {
  const filter = { client: clientId };
  const [items, total] = await Promise.all([
    ClientAssignmentHistory.find(filter)
      .populate('previousAdmin', 'name adminCode')
      .populate('newAdmin', 'name adminCode')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    ClientAssignmentHistory.countDocuments(filter),
  ]);
  return {
    items: items.map(serializeHistoryEntry),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

module.exports = { assignClient, unassignClient, getAssignmentHistory, assertEligibleAdmin };
