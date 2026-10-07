const { body, param, query } = require('express-validator');
const { ALL_CLIENT_STATUSES } = require('../../constants/portal/clientStatus');

const SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'companyName', 'status', 'clientCode'];
const MAX_PAGE_SIZE = 100;

const idParam = param('id').isMongoId().withMessage('Invalid client id.');
const idOnlyValidator = [idParam];

const phoneField = (field, { optional = true } = {}) => {
  let chain = body(field);
  chain = optional ? chain.optional({ nullable: true }) : chain;
  return chain
    .isString()
    .trim()
    .matches(/^[0-9+\-\s()]{6,20}$/)
    .withMessage(`${field} must be a valid phone number.`);
};

const gstField = body('gstNumber')
  .optional({ nullable: true })
  .isString()
  .trim()
  .matches(/^[0-9A-Z]{15}$/)
  .withMessage('gstNumber must be a valid 15-character GSTIN.');

const panField = body('panNumber')
  .optional({ nullable: true })
  .isString()
  .trim()
  .toUpperCase()
  .matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
  .withMessage('panNumber must be a valid PAN (e.g. ABCDE1234F).');

const listClientsValidator = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: MAX_PAGE_SIZE }).toInt(),
  query('search').optional().isString().trim().isLength({ max: 200 }),
  query('status').optional().isIn(ALL_CLIENT_STATUSES),
  query('assignedAdmin').optional().isMongoId(),
  query('city').optional().isString().trim().isLength({ max: 100 }),
  query('state').optional().isString().trim().isLength({ max: 100 }),
  query('companyName').optional().isString().trim().isLength({ max: 150 }),
  query('sortBy').optional().isIn(SORT_FIELDS).withMessage(`sortBy must be one of: ${SORT_FIELDS.join(', ')}.`),
  query('sortDir').optional().isIn(['asc', 'desc']),
];

const createClientValidator = [
  body('name').isString().trim().isLength({ min: 1, max: 150 }).withMessage('Name is required.'),
  body('email').isString().trim().isEmail().withMessage('A valid email is required.').isLength({ max: 254 }).toLowerCase(),
  phoneField('phone', { optional: false }),
  body('companyName').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
  phoneField('alternatePhone'),
  body('address').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('city').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('state').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('country').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('postalCode').optional({ nullable: true }).isString().trim().isLength({ max: 20 }),
  gstField,
  panField,
  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
];

const ALLOWED_UPDATE_FIELDS = [
  'name',
  'companyName',
  'phone',
  'alternatePhone',
  'address',
  'city',
  'state',
  'country',
  'postalCode',
  'gstNumber',
  'panNumber',
  'notes',
];

const updateClientValidator = [
  idParam,
  body().custom((value) => {
    const unknown = Object.keys(value || {}).filter((key) => !ALLOWED_UPDATE_FIELDS.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `These fields cannot be changed here: ${unknown.join(', ')}. Use the dedicated status/assignment endpoints.`
      );
    }
    return true;
  }),
  body('name').optional().isString().trim().isLength({ min: 1, max: 150 }),
  body('companyName').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
  phoneField('phone'),
  phoneField('alternatePhone'),
  body('address').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('city').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('state').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('country').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('postalCode').optional({ nullable: true }).isString().trim().isLength({ max: 20 }),
  gstField,
  panField,
  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
];

const updateStatusValidator = [
  idParam,
  body('status').isIn(ALL_CLIENT_STATUSES).withMessage(`status must be one of: ${ALL_CLIENT_STATUSES.join(', ')}.`),
  body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
];

const assignValidator = [
  idParam,
  body('adminId').isMongoId().withMessage('A valid adminId is required.'),
  body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
];

const archiveValidator = [idParam, body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 })];

const SELF_PROFILE_FIELDS = ['name', 'phone', 'alternatePhone', 'address', 'city', 'state', 'postalCode', 'companyName'];

const updateOwnProfileValidator = [
  body().custom((value) => {
    const unknown = Object.keys(value || {}).filter((key) => !SELF_PROFILE_FIELDS.includes(key));
    if (unknown.length > 0) {
      throw new Error(`These fields cannot be changed: ${unknown.join(', ')}.`);
    }
    return true;
  }),
  body('name').optional().isString().trim().isLength({ min: 1, max: 150 }),
  body('companyName').optional({ nullable: true }).isString().trim().isLength({ max: 150 }),
  phoneField('phone'),
  phoneField('alternatePhone'),
  body('address').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('city').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('state').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('postalCode').optional({ nullable: true }).isString().trim().isLength({ max: 20 }),
];

module.exports = {
  SORT_FIELDS,
  MAX_PAGE_SIZE,
  idOnlyValidator,
  listClientsValidator,
  createClientValidator,
  updateClientValidator,
  updateStatusValidator,
  assignValidator,
  archiveValidator,
  updateOwnProfileValidator,
};
