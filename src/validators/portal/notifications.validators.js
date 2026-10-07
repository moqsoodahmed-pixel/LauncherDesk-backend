const { query, param, body } = require('express-validator');
const { ALL_NOTIFICATION_EVENTS } = require('../../constants/portal/notificationEvents');

// Every accepted filter is explicitly named/typed - never a passthrough of
// req.query into a Mongo filter, so there is no path for an operator
// injection regardless of what's sent.
const listNotificationsValidator = [
  query('isRead').optional().isBoolean().toBoolean(),
  query('type').optional().isIn(ALL_NOTIFICATION_EVENTS),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
];

const notificationIdParamValidator = [param('id').isMongoId().withMessage('Invalid notification id.')];

module.exports = { listNotificationsValidator, notificationIdParamValidator };
