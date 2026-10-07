const clientsService = require('../../services/portal/clients.service');
const { sendSuccess } = require('../../utils/portal/apiResponse');
const { logAudit } = require('../../services/portal/auditLog.service');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

function pagination(req) {
  const page = parseInt(req.query.page, 10);
  const limit = parseInt(req.query.limit, 10);
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20,
  };
}

async function list(req, res, next) {
  try {
    const { page, limit, search, status, assignedAdmin, city, state, companyName, sortBy, sortDir, dateFrom, dateTo } = req.query;
    const result = await clientsService.listClients(req.scopeFilter, {
      page,
      limit,
      search,
      status,
      assignedAdmin,
      city,
      state,
      companyName,
      sortBy,
      sortDir,
      dateFrom,
      dateTo,
    });
    return sendSuccess(res, { message: 'Clients.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const client = await clientsService.createClient(req.body, req.user, requestMeta(req));
    return sendSuccess(res, { statusCode: 201, message: 'Client created.', data: client });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const client = await clientsService.getClientById(req.resource);
    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: AUDIT_ACTIONS.CLIENT_PROFILE_VIEWED,
      resourceType: 'Client',
      resourceId: req.resource._id,
      ...requestMeta(req),
    });
    return sendSuccess(res, { message: 'Client.', data: client });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const client = await clientsService.updateClient(req.resource, req.body, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Client updated.', data: client });
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const client = await clientsService.updateClientStatus(req.resource, req.body.status, req.user, {
      reason: req.body.reason,
      ...requestMeta(req),
    });
    return sendSuccess(res, { message: 'Client status updated.', data: client });
  } catch (err) {
    next(err);
  }
}

async function archive(req, res, next) {
  try {
    const client = await clientsService.archiveClient(req.resource, req.user, { reason: req.body?.reason, ...requestMeta(req) });
    return sendSuccess(res, { message: 'Client archived.', data: client });
  } catch (err) {
    next(err);
  }
}

async function assign(req, res, next) {
  try {
    const client = await clientsService.assignClientToAdmin(req.resource._id, req.body.adminId, req.user, {
      reason: req.body.reason,
      ...requestMeta(req),
    });
    return sendSuccess(res, { message: 'Client assigned.', data: client });
  } catch (err) {
    next(err);
  }
}

// Same handler as assign(): assignClientToAdmin() auto-detects whether this
// is a first assignment or a reassignment (one source of truth either way).
const reassign = assign;

async function unassign(req, res, next) {
  try {
    const client = await clientsService.unassignClientFromAdmin(req.resource._id, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Client unassigned.', data: client });
  } catch (err) {
    next(err);
  }
}

async function getAssignmentHistory(req, res, next) {
  try {
    const result = await clientsService.getClientAssignmentHistory(req.resource._id, pagination(req));
    return sendSuccess(res, { message: 'Client assignment history.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function getActivity(req, res, next) {
  try {
    const result = await clientsService.getClientActivity(req.resource._id, pagination(req));
    return sendSuccess(res, { message: 'Client activity.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function getOwnProfile(req, res, next) {
  try {
    const profile = await clientsService.getOwnProfile(req.user);
    return sendSuccess(res, { message: 'Your profile.', data: profile });
  } catch (err) {
    next(err);
  }
}

async function updateOwnProfile(req, res, next) {
  try {
    const profile = await clientsService.updateOwnProfile(req.user, req.body, requestMeta(req));
    return sendSuccess(res, { message: 'Profile updated.', data: profile });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  getById,
  update,
  updateStatus,
  archive,
  assign,
  reassign,
  unassign,
  getAssignmentHistory,
  getActivity,
  getOwnProfile,
  updateOwnProfile,
};
