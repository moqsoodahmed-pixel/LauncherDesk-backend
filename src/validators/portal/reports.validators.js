const { query } = require('express-validator');
const { ALL_REPORT_PERIODS } = require('../../constants/portal/reportPeriods');

// Every accepted filter is explicitly named/typed - never a passthrough
// of req.query into a Mongo filter/sort, so there is no path for an
// operator injection or an arbitrary sort field regardless of input.
const reportQueryValidator = [
  query('period').optional().isIn(ALL_REPORT_PERIODS),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('serviceId').optional().isMongoId(),
  query('adminId').optional().isMongoId(),
  query('clientId').optional().isMongoId(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sort').optional().isIn(['orderCount', 'revenue', 'completions']),
  query('order').optional().isIn(['asc', 'desc']),
];

module.exports = { reportQueryValidator };
