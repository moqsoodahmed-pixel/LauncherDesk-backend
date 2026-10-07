const auditQueryService = require('../../services/portal/auditQuery.service');
const { sendSuccess } = require('../../utils/portal/apiResponse');

async function list(req, res, next) {
  try {
    const result = await auditQueryService.listAuditLogsForUser(req.user, req.query);
    return sendSuccess(res, { message: 'Audit logs.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
