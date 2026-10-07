const { body, param, query } = require('express-validator');
const { ALL_ORDER_STATUSES } = require('../../constants/portal/orderStatus');
const { ALL_ORDER_PAYMENT_STATUSES } = require('../../constants/portal/orderPaymentStatus');
const { ALL_ORDER_SOURCES } = require('../../constants/portal/orderSource');
const { ALL_SERVICE_CATEGORIES } = require('../../constants/portal/serviceCategory');

const SORT_FIELDS = ['createdAt', 'updatedAt', 'orderCode', 'status', 'paymentStatus'];
const MAX_PAGE_SIZE = 100;

const idParam = param('id').isMongoId().withMessage('Invalid order id.');
const idOnlyValidator = [idParam];

const listOrdersValidator = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: MAX_PAGE_SIZE }).toInt(),
  query('search').optional().isString().trim().isLength({ max: 200 }),
  query('status').optional().isIn(ALL_ORDER_STATUSES),
  query('paymentStatus').optional().isIn(ALL_ORDER_PAYMENT_STATUSES),
  query('client').optional().isMongoId(),
  query('service').optional().isMongoId(),
  query('assignedAdmin').optional().isMongoId(),
  query('source').optional().isIn(ALL_ORDER_SOURCES),
  query('category').optional().isIn(ALL_SERVICE_CATEGORIES),
  query('dateFrom').optional().isISO8601().withMessage('dateFrom must be a valid date.'),
  query('dateTo').optional().isISO8601().withMessage('dateTo must be a valid date.'),
  query('sortBy').optional().isIn(SORT_FIELDS).withMessage(`sortBy must be one of: ${SORT_FIELDS.join(', ')}.`),
  query('sortDir').optional().isIn(['asc', 'desc']),
];

// Client self-service listing: the same allowlist/cap discipline as the
// internal list, but without `client`/`assignedAdmin`/`source` - those are
// internal-operations filters a Client has no legitimate reason to query
// by (their results are already restricted to their own orders regardless
// via scopeOrders, but there's no reason to expose the parameter at all).
const listClientOrdersValidator = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: MAX_PAGE_SIZE }).toInt(),
  query('search').optional().isString().trim().isLength({ max: 200 }),
  query('status').optional().isIn(ALL_ORDER_STATUSES),
  query('paymentStatus').optional().isIn(ALL_ORDER_PAYMENT_STATUSES),
  query('service').optional().isMongoId(),
  query('dateFrom').optional().isISO8601().withMessage('dateFrom must be a valid date.'),
  query('dateTo').optional().isISO8601().withMessage('dateTo must be a valid date.'),
  query('sortBy').optional().isIn(SORT_FIELDS).withMessage(`sortBy must be one of: ${SORT_FIELDS.join(', ')}.`),
  query('sortDir').optional().isIn(['asc', 'desc']),
];

// orderDetails is deliberately only checked for shape here (object, not
// array/primitive) - the real per-field validation against the Service's
// formSchema happens in orderFormValidation.service.js, which also knows
// which fields actually apply to the chosen service.
const orderDetailsField = body('orderDetails')
  .optional()
  .custom((value) => typeof value === 'object' && value !== null && !Array.isArray(value))
  .withMessage('orderDetails must be an object.');

const createOrderValidator = [
  body('clientId').isMongoId().withMessage('A valid clientId is required.'),
  body('serviceId').isMongoId().withMessage('A valid serviceId is required.'),
  orderDetailsField,
  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
];

// No clientId field at all - a Client can never choose who they are
// ordering as. Any extra field (clientId, status, pricing, ...) is
// rejected outright by the allowlist below, not silently dropped.
const CLIENT_ORDER_ALLOWED_FIELDS = ['serviceId', 'orderDetails'];
const createClientOrderValidator = [
  body().custom((value) => {
    const unknown = Object.keys(value || {}).filter((key) => !CLIENT_ORDER_ALLOWED_FIELDS.includes(key));
    if (unknown.length > 0) {
      throw new Error(`These fields cannot be submitted: ${unknown.join(', ')}.`);
    }
    return true;
  }),
  body('serviceId').isMongoId().withMessage('A valid serviceId is required.'),
  orderDetailsField,
];

const ALLOWED_UPDATE_FIELDS = ['notes', 'priority', 'slaDeadline'];
const updateOrderValidator = [
  idParam,
  body().custom((value) => {
    const unknown = Object.keys(value || {}).filter((key) => !ALLOWED_UPDATE_FIELDS.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `These fields cannot be changed here: ${unknown.join(', ')}. Use the dedicated status/assignment/cancel endpoints for the rest.`
      );
    }
    return true;
  }),
  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
];

const updateStatusValidator = [
  idParam,
  body('status').isIn(ALL_ORDER_STATUSES).withMessage(`status must be one of: ${ALL_ORDER_STATUSES.join(', ')}.`),
  body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
];

const assignValidator = [idParam, body('adminId').isMongoId().withMessage('A valid adminId is required.'), body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 })];

const cancelValidator = [
  idParam,
  body('reason').isString().trim().isLength({ min: 1, max: 500 }).withMessage('A cancellation reason is required.'),
];

const closeValidator = [idParam];

const paymentStatusValidator = [
  idParam,
  body('paymentStatus').isIn(ALL_ORDER_PAYMENT_STATUSES).withMessage(`paymentStatus must be one of: ${ALL_ORDER_PAYMENT_STATUSES.join(', ')}.`),
  body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
];

const devAdvanceValidator = [
  idParam,
  body('toStatus').isIn(['KYC_DELETION_PENDING', 'CLOSED']).withMessage('toStatus must be KYC_DELETION_PENDING or CLOSED for this dev-only endpoint.'),
];

module.exports = {
  SORT_FIELDS,
  MAX_PAGE_SIZE,
  idOnlyValidator,
  listOrdersValidator,
  listClientOrdersValidator,
  createOrderValidator,
  createClientOrderValidator,
  updateOrderValidator,
  updateStatusValidator,
  assignValidator,
  cancelValidator,
  closeValidator,
  paymentStatusValidator,
  devAdvanceValidator,
};
