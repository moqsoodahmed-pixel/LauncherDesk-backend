const communicationQueryService = require('../../services/portal/communicationQuery.service');
const { sendSuccess } = require('../../utils/portal/apiResponse');

async function list(req, res, next) {
  try {
    const result = await communicationQueryService.listCommunicationsForUser(req.user, req.query);
    return sendSuccess(res, { message: 'Communications.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function listForOwnOrder(req, res, next) {
  try {
    const items = await communicationQueryService.listCommunicationsForOwnOrder(req.resource._id);
    return sendSuccess(res, { message: 'Communications.', data: items });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, listForOwnOrder };
