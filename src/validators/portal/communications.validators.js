const { query } = require('express-validator');
const { ALL_COMMUNICATION_CHANNELS } = require('../../constants/portal/communicationChannels');
const { ALL_COMMUNICATION_STATUSES } = require('../../constants/portal/communicationStatus');
const { ALL_COMMUNICATION_EVENTS } = require('../../constants/portal/communicationEvents');

// Every accepted filter is explicitly named and type-checked here - nothing
// from req.query is ever passed through to a Mongo filter unvalidated, so
// there is no path for a Mongo operator ($where, $ne, ...) to reach a query.
const listCommunicationsValidator = [
  query('order').optional().isMongoId(),
  query('client').optional().isMongoId(),
  query('channel').optional().isIn(ALL_COMMUNICATION_CHANNELS),
  query('status').optional().isIn(ALL_COMMUNICATION_STATUSES),
  query('event').optional().isIn(ALL_COMMUNICATION_EVENTS),
  query('dateFrom').optional().isISO8601(),
  query('dateTo').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { listCommunicationsValidator };
