const mongoose = require('mongoose');
const { Client, User, AuditLog } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { ROLES } = require('../../constants/portal/roles');
const { USER_STATUS } = require('../../constants/portal/userStatus');
const { CLIENT_STATUS, isValidClientStatusTransition } = require('../../constants/portal/clientStatus');
const { CLIENT_PERMISSIONS } = require('../../constants/portal/permissions');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { hashPassword } = require('./password.service');
const { generateClientCode } = require('./idGenerator.service');
const { logAudit } = require('./auditLog.service');
const { syncClientAuthStatus } = require('./clientAuthSync.service');
const clientAssignment = require('./clientAssignment.service');
const notificationEventsService = require('./notificationEvents.service');

function auditCtx(actor) {
  return { actor: actor._id, actorRole: actor.role };
}

/** Full shape for internal (Admin/Super Admin) consumers. */
function serializeClient(client) {
  return {
    id: client._id,
    clientCode: client.clientCode,
    user: client.user ?? null,
    name: client.name,
    companyName: client.companyName ?? null,
    email: client.email,
    phone: client.phone ?? null,
    alternatePhone: client.alternatePhone ?? null,
    address: client.address ?? null,
    city: client.city ?? null,
    state: client.state ?? null,
    country: client.country ?? null,
    postalCode: client.postalCode ?? null,
    gstNumber: client.gst?.number ?? null,
    panNumber: client.panNumber ?? null,
    notes: client.notes ?? null,
    status: client.status,
    // client.assignedAdmin._id is NOT a reliable "is this populated" test: BSON's
    // ObjectId class exposes a self-referential _id getter (returns itself), so an
    // UNPOPULATED raw id also has a truthy ._id - that always took this branch and
    // produced { id: <raw ObjectId>, name: undefined, adminCode: null } instead of
    // falling through to return the raw id. Checking .name (always set on a real
    // PortalUser, never present on a bare ObjectId) is the reliable discriminator.
    assignedAdmin: client.assignedAdmin
      ? (client.assignedAdmin.name !== undefined
          ? { id: client.assignedAdmin._id, name: client.assignedAdmin.name, adminCode: client.assignedAdmin.adminCode ?? null }
          : client.assignedAdmin)
      : null,
    assignedAt: client.assignedAt ?? null,
    lastActivityAt: client.lastActivityAt ?? null,
    createdBy: client.createdBy ?? null,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

/**
 * Narrow, self-service shape: never exposes internal notes, the assigned
 * admin, createdBy, or any other internal/audit field.
 */
function serializeClientForSelf(client) {
  return {
    clientCode: client.clientCode,
    name: client.name,
    companyName: client.companyName ?? null,
    email: client.email,
    phone: client.phone ?? null,
    alternatePhone: client.alternatePhone ?? null,
    address: client.address ?? null,
    city: client.city ?? null,
    state: client.state ?? null,
    country: client.country ?? null,
    postalCode: client.postalCode ?? null,
    gstNumber: client.gst?.number ?? null,
    panNumber: client.panNumber ?? null,
    status: client.status,
    createdAt: client.createdAt,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the Mongo filter for list/search, merged with (never replacing)
 * the caller's data-scope filter. Every value is validated upstream by
 * clients.validators.js before it reaches here (status against the enum,
 * assignedAdmin as a Mongo id, free-text fields length-capped) - no raw
 * operator object from the query string is ever interpolated into the
 * filter.
 */
function buildListFilter({ search, status, assignedAdmin, city, state, companyName, dateFrom, dateTo }) {
  const filter = {};
  if (status) filter.status = status;
  if (assignedAdmin) filter.assignedAdmin = assignedAdmin;
  if (city) filter.city = new RegExp(`^${escapeRegex(city)}$`, 'i');
  if (state) filter.state = new RegExp(`^${escapeRegex(state)}$`, 'i');
  if (companyName) filter.companyName = new RegExp(escapeRegex(companyName), 'i');
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ clientCode: re }, { legacyClientCode: re }, { legacyCode: re }, { name: re }, { companyName: re }, { email: re }, { phone: re }];
  }
  return filter;
}

async function listClients(scopeFilter, { page = 1, limit = 20, sortBy = 'createdAt', sortDir = 'desc', ...filters }) {
  const filter = { $and: [scopeFilter, buildListFilter(filters)] };
  const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };

  const [items, total] = await Promise.all([
    Client.find(filter)
      .populate('assignedAdmin', 'name adminCode')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    Client.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeClient),
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

async function getClientById(client) {
  // `client` is already the scope-checked document, loaded by the
  // loadScoped() IDOR-safe middleware in clients.routes.js. loadScoped is
  // generic (shared with Orders etc.) and never populates - without this,
  // assignedAdmin stays a bare ObjectId here, so serializeClient's rich
  // {id, name, adminCode} branch never fires and the client detail page
  // (unlike the list page, which already populates) shows a raw Mongo id
  // instead of the admin's name.
  if (client.assignedAdmin) {
    await client.populate('assignedAdmin', 'name adminCode');
  }
  const result = serializeClient(client);
  if (client.user) {
    const account = await User.findById(client.user).select('email status lastLogin');
    if (account) {
      result.authAccount = { email: account.email, status: account.status, lastLogin: account.lastLogin };
    }
  }
  return result;
}

/**
 * Creates a Client profile and its linked login User account together.
 * Uses a real MongoDB transaction when the deployment supports one
 * (replica set / Atlas); on a standalone dev `mongod`, which cannot run
 * transactions, falls back to sequential creation with manual rollback of
 * the Client if the User step fails, so a crash never leaves a client
 * profile with no way to log in.
 */
async function createClient(payload, actor, meta = {}) {
  const email = String(payload.email).toLowerCase().trim();

  const [existingClient, existingUser] = await Promise.all([Client.findOne({ email }), User.findOne({ email })]);
  if (existingClient || existingUser) {
    throw AppError.conflict('A client or account with this email already exists.');
  }

  const clientCode = await generateClientCode();
  const clientDoc = {
    clientCode,
    name: payload.name,
    email,
    phone: payload.phone,
    companyName: payload.companyName ?? null,
    alternatePhone: payload.alternatePhone ?? null,
    address: payload.address ?? null,
    city: payload.city ?? null,
    state: payload.state ?? null,
    country: payload.country || 'India',
    postalCode: payload.postalCode ?? null,
    gst: { number: payload.gstNumber ?? null, applicable: !!payload.gstNumber },
    panNumber: payload.panNumber ?? null,
    notes: payload.notes ?? null,
    status: CLIENT_STATUS.PENDING,
    createdBy: actor._id,
  };

  const temporaryPassword = require('crypto').randomBytes(12).toString('base64url');

  let client;
  let user;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [createdClient] = await Client.create([clientDoc], { session });
      const [createdUser] = await User.create(
        [
          {
            name: payload.name,
            email,
            passwordHash: await hashPassword(temporaryPassword),
            role: ROLES.CLIENT,
            permissions: CLIENT_PERMISSIONS,
            clientProfile: createdClient._id,
            status: USER_STATUS.PENDING,
          },
        ],
        { session }
      );
      createdClient.user = createdUser._id;
      await createdClient.save({ session });
      client = createdClient;
      user = createdUser;
    });
  } catch (err) {
    // Standalone mongod (no replica set) cannot run transactions at all -
    // this is expected in a lot of dev setups, not a real failure. Fall
    // back to sequential writes with manual rollback.
    // Also matches MongoDB-compatible servers without transaction support (e.g. FerretDB).
    if (!/Transaction numbers|replica set|autocommit|transactions? (are )?not supported/i.test(err.message || '')) {
      throw err;
    }
    client = await Client.create(clientDoc);
    try {
      user = await User.create({
        name: payload.name,
        email,
        passwordHash: await hashPassword(temporaryPassword),
        role: ROLES.CLIENT,
        permissions: CLIENT_PERMISSIONS,
        clientProfile: client._id,
        status: USER_STATUS.PENDING,
      });
      client.user = user._id;
      await client.save();
    } catch (userErr) {
      await Client.deleteOne({ _id: client._id }); // avoid an orphaned, login-less client
      throw userErr;
    }
  } finally {
    await session.endSession();
  }

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.CLIENT_CREATED,
    resourceType: 'Client',
    resourceId: client._id,
    metadata: { clientCode: client.clientCode, email: client.email },
    ...meta,
  });
  await notificationEventsService.notifyClientCreated(client, actor?._id).catch(() => {});

  return serializeClient(client);
}

async function updateClient(client, changes, actor, meta = {}) {
  const fieldMap = {
    name: 'name',
    companyName: 'companyName',
    phone: 'phone',
    alternatePhone: 'alternatePhone',
    address: 'address',
    city: 'city',
    state: 'state',
    country: 'country',
    postalCode: 'postalCode',
    notes: 'notes',
  };
  const applied = {};
  for (const [key, field] of Object.entries(fieldMap)) {
    if (changes[key] !== undefined) {
      client[field] = changes[key];
      applied[key] = true;
    }
  }
  if (changes.gstNumber !== undefined) {
    client.gst = { number: changes.gstNumber || null, applicable: !!changes.gstNumber };
    applied.gstNumber = true;
  }
  if (changes.panNumber !== undefined) {
    client.panNumber = changes.panNumber || null;
    applied.panNumber = true;
  }

  client.lastActivityAt = new Date();
  await client.save();

  // Keep the linked login account's display name in sync, same as Phase 1's
  // self-service profile update - never touches email/role/permissions.
  if (changes.name !== undefined && client.user) {
    await User.updateOne({ _id: client.user }, { name: changes.name });
  }

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.CLIENT_UPDATED,
    resourceType: 'Client',
    resourceId: client._id,
    metadata: { fields: Object.keys(applied) },
    ...meta,
  });

  return serializeClient(client);
}

async function updateClientStatus(client, status, actor, { reason, ...meta } = {}) {
  if (!isValidClientStatusTransition(client.status, status)) {
    throw AppError.invalidStateTransition(`Cannot move a client from ${client.status} to ${status}.`);
  }

  const previousStatus = client.status;
  client.status = status;
  client.lastActivityAt = new Date();
  await client.save();

  await syncClientAuthStatus(client, actor, meta);

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.CLIENT_STATUS_CHANGED,
    resourceType: 'Client',
    resourceId: client._id,
    metadata: { from: previousStatus, to: status, reason: reason || null },
    ...meta,
  });
  await notificationEventsService.notifyClientStatusChanged(client, status).catch(() => {});

  return serializeClient(client);
}

/** Soft delete: DELETE /api/clients/:id always archives, never destroys the record. */
async function archiveClient(client, actor, { reason, ...meta } = {}) {
  if (client.status === CLIENT_STATUS.ARCHIVED) {
    throw AppError.conflict('This client is already archived.');
  }

  const previousStatus = client.status;
  client.status = CLIENT_STATUS.ARCHIVED;
  client.lastActivityAt = new Date();
  await client.save();

  await syncClientAuthStatus(client, actor, meta);

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.CLIENT_ARCHIVED,
    resourceType: 'Client',
    resourceId: client._id,
    metadata: { from: previousStatus, reason: reason || null },
    ...meta,
  });

  return serializeClient(client);
}

async function getClientActivity(clientId, { page = 1, limit = 20 } = {}) {
  const filter = { resourceType: 'Client', resourceId: clientId };
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

async function assignClientToAdmin(clientId, adminId, actor, { reason, ...meta } = {}) {
  const client = await clientAssignment.assignClient({ clientId, adminId, actor, reason, meta });
  return serializeClient(client);
}

async function unassignClientFromAdmin(clientId, actor, { reason, ...meta } = {}) {
  const client = await clientAssignment.unassignClient({ clientId, actor, reason, meta });
  return serializeClient(client);
}

async function getClientAssignmentHistory(clientId, pagination) {
  return clientAssignment.getAssignmentHistory(clientId, pagination);
}

/** GET /api/client/profile - the authenticated Client's own record. */
async function getOwnProfile(user) {
  if (!user.clientProfile) {
    throw AppError.notFound('No client profile is linked to this account yet.');
  }
  const client = await Client.findById(user.clientProfile);
  if (!client) throw AppError.notFound('No client profile is linked to this account yet.');
  return serializeClientForSelf(client);
}

async function updateOwnProfile(user, changes, meta = {}) {
  if (!user.clientProfile) {
    throw AppError.notFound('No client profile is linked to this account yet.');
  }
  const client = await Client.findById(user.clientProfile);
  if (!client) throw AppError.notFound('No client profile is linked to this account yet.');

  const fields = ['name', 'companyName', 'phone', 'alternatePhone', 'address', 'city', 'state', 'postalCode'];
  const applied = {};
  for (const field of fields) {
    if (changes[field] !== undefined) {
      client[field] = changes[field];
      applied[field] = true;
    }
  }
  client.lastActivityAt = new Date();
  await client.save();

  if (changes.name !== undefined) {
    await User.updateOne({ _id: user._id }, { name: changes.name });
  }

  await logAudit({
    actor: user._id,
    actorRole: user.role,
    action: AUDIT_ACTIONS.CLIENT_SELF_PROFILE_UPDATED,
    resourceType: 'Client',
    resourceId: client._id,
    metadata: { fields: Object.keys(applied) },
    ...meta,
  });

  return serializeClientForSelf(client);
}

module.exports = {
  serializeClient,
  serializeClientForSelf,
  listClients,
  getClientById,
  createClient,
  updateClient,
  updateClientStatus,
  archiveClient,
  getClientActivity,
  assignClientToAdmin,
  unassignClientFromAdmin,
  getClientAssignmentHistory,
  getOwnProfile,
  updateOwnProfile,
};
