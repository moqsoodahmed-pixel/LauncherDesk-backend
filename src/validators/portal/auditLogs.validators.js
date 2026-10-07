const { query } = require('express-validator');

// Deliberately NOT validating `action` against a fixed enum (new audit
// actions are added over time) - but it must still be a short plain
// string, never an object/array that could smuggle a Mongo operator.
const listAuditLogsValidator = [
  query('action').optional().isString().trim().isLength({ max: 100 }),
  query('actor').optional().isMongoId(),
  query('resourceType').optional().isString().trim().isLength({ max: 50 }),
  query('resourceId').optional().isMongoId(),
  query('dateFrom').optional().isISO8601(),
  query('dateTo').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = { listAuditLogsValidator };
