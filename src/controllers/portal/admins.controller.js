const adminsService = require('../../services/portal/admins.service');
const { sendSuccess } = require('../../utils/portal/apiResponse');

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
    const { page, limit, search, status, role, department, dataScope, sortBy, sortDir, dateFrom, dateTo } = req.query;
    const result = await adminsService.listAdmins({ page, limit, search, status, role, department, dataScope, sortBy, sortDir, dateFrom, dateTo });
    return sendSuccess(res, { message: 'Admins.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const admin = await adminsService.createAdmin(req.body, req.user, requestMeta(req));
    return sendSuccess(res, { statusCode: 201, message: 'Admin created.', data: admin });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const admin = await adminsService.getAdminById(req.params.id);
    return sendSuccess(res, { message: 'Admin.', data: admin });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const admin = await adminsService.updateAdmin(req.params.id, req.body, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Admin updated.', data: admin });
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const admin = await adminsService.updateStatus(req.params.id, req.body.status, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Admin status updated.', data: admin });
  } catch (err) {
    next(err);
  }
}

async function getPermissions(req, res, next) {
  try {
    const data = await adminsService.getPermissions(req.params.id);
    return sendSuccess(res, { message: 'Admin permissions.', data });
  } catch (err) {
    next(err);
  }
}

async function updatePermissions(req, res, next) {
  try {
    const data = await adminsService.updatePermissions(req.params.id, req.body.permissions, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Admin permissions updated.', data });
  } catch (err) {
    next(err);
  }
}

async function updateScope(req, res, next) {
  try {
    const data = await adminsService.updateScope(req.params.id, req.body.dataScope, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Admin data scope updated.', data });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    await adminsService.resetPassword(
      req.params.id,
      { mode: req.body.mode || 'SET_PASSWORD', newPassword: req.body.newPassword },
      req.user,
      requestMeta(req)
    );
    return sendSuccess(res, { message: 'Password reset. All existing sessions for this admin have been revoked.' });
  } catch (err) {
    next(err);
  }
}

async function getSessions(req, res, next) {
  try {
    const sessions = await adminsService.getSessions(req.params.id);
    return sendSuccess(res, { message: 'Admin sessions.', data: sessions });
  } catch (err) {
    next(err);
  }
}

async function revokeSessions(req, res, next) {
  try {
    await adminsService.revokeSessions(req.params.id, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'All sessions for this admin have been revoked.' });
  } catch (err) {
    next(err);
  }
}

async function getActivity(req, res, next) {
  try {
    const result = await adminsService.getActivity(req.params.id, pagination(req));
    return sendSuccess(res, { message: 'Admin activity.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function listClients(req, res, next) {
  try {
    const result = await adminsService.listAdminClients(req.params.id, pagination(req));
    return sendSuccess(res, { message: 'Assigned clients.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function assignClient(req, res, next) {
  try {
    const client = await adminsService.assignClient(req.params.id, req.body.clientId, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Client assigned.', data: client });
  } catch (err) {
    next(err);
  }
}

async function bulkAssignClients(req, res, next) {
  try {
    const clients = await adminsService.bulkAssignClients(req.params.id, req.body.clientIds, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Clients assigned.', data: clients });
  } catch (err) {
    next(err);
  }
}

async function unassignClient(req, res, next) {
  try {
    const result = await adminsService.unassignClient(req.params.id, req.params.clientId, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Client unassigned.', data: result });
  } catch (err) {
    next(err);
  }
}

async function getStats(req, res, next) {
  try {
    const stats = await adminsService.getAdminStats(req.params.id);
    return sendSuccess(res, { message: 'Admin stats.', data: stats });
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
  getPermissions,
  updatePermissions,
  updateScope,
  resetPassword,
  getSessions,
  revokeSessions,
  getActivity,
  listClients,
  assignClient,
  bulkAssignClients,
  unassignClient,
  getStats,
};
