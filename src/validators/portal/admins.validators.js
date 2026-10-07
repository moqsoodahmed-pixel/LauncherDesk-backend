const { body, param, query } = require('express-validator');
const { ALL_PERMISSIONS } = require('../../constants/portal/permissions');
const { DATA_SCOPES } = require('../../constants/portal/dataScopes');
const { ALL_ROLES, ROLES } = require('../../constants/portal/roles');
const { ALL_USER_STATUSES } = require('../../constants/portal/userStatus');
const { MAX_PASSWORD_LENGTH, PASSWORD_POLICY_MESSAGE, isPasswordStrongEnough } = require('../../services/portal/password.service');

// Only ADMIN / SUPER_ADMIN are ever managed through this module - CLIENT
// accounts are a separate module (Phase 3).
const MANAGEABLE_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];
const CLIENT_DATA_SCOPES = [DATA_SCOPES.ONLY_ASSIGNED_CLIENTS, DATA_SCOPES.ALL_CLIENTS];
const ORDER_DATA_SCOPES = [DATA_SCOPES.ASSIGNED_ORDERS, DATA_SCOPES.ALL_ORDERS];

const idParam = param('id').isMongoId().withMessage('Invalid id.');
const clientIdParam = param('clientId').isMongoId().withMessage('Invalid client id.');
const idOnlyValidator = [idParam];

const permissionsField = body('permissions')
  .isArray()
  .withMessage('permissions must be an array.')
  .bail()
  .custom((permissions) => {
    const unknown = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
    if (unknown.length > 0) {
      throw new Error(`Unknown permission(s): ${unknown.join(', ')}.`);
    }
    return true;
  });

const dataScopeField = body('dataScope')
  .isObject()
  .withMessage('dataScope must be an object.')
  .bail()
  .custom((scope) => {
    if (!CLIENT_DATA_SCOPES.includes(scope.clients)) {
      throw new Error(`dataScope.clients must be one of: ${CLIENT_DATA_SCOPES.join(', ')}.`);
    }
    if (!ORDER_DATA_SCOPES.includes(scope.orders)) {
      throw new Error(`dataScope.orders must be one of: ${ORDER_DATA_SCOPES.join(', ')}.`);
    }
    return true;
  });

const listAdminsValidator = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('search').optional().isString().trim().isLength({ max: 200 }),
  query('status').optional().isIn(ALL_USER_STATUSES),
  query('role').optional().isIn(MANAGEABLE_ROLES),
  query('department').optional().isString().trim().isLength({ max: 100 }),
  query('dataScope').optional().isIn([...CLIENT_DATA_SCOPES, ...ORDER_DATA_SCOPES]),
  query('sortBy').optional().isIn(['createdAt', 'name', 'email', 'lastLogin', 'status']),
  query('sortDir').optional().isIn(['asc', 'desc']),
];

const createAdminValidator = [
  body('name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Name is required.'),
  body('email').isString().trim().isEmail().withMessage('A valid email is required.').isLength({ max: 254 }).toLowerCase(),
  body('phone')
    .optional({ nullable: true })
    .isString()
    .trim()
    .matches(/^[0-9+\-\s()]{6,20}$/)
    .withMessage('Phone number is invalid.'),
  body('department').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('role').optional().isIn(MANAGEABLE_ROLES).withMessage(`role must be one of: ${MANAGEABLE_ROLES.join(', ')}.`),
  body('status').optional().isIn(ALL_USER_STATUSES),
  body('password')
    .isString()
    .custom((value) => isPasswordStrongEnough(value))
    .withMessage(PASSWORD_POLICY_MESSAGE),
  body('permissions').optional().custom((v) => Array.isArray(v)).withMessage('permissions must be an array.'),
  body('permissions.*').optional().isIn(ALL_PERMISSIONS).withMessage('Unknown permission.'),
  body('dataScope').optional().isObject(),
  body('dataScope.clients').optional().isIn(CLIENT_DATA_SCOPES),
  body('dataScope.orders').optional().isIn(ORDER_DATA_SCOPES),
];

const ALLOWED_UPDATE_FIELDS = ['name', 'phone', 'department', 'role', 'status'];

const updateAdminValidator = [
  idParam,
  body().custom((value) => {
    const unknown = Object.keys(value || {}).filter((key) => !ALLOWED_UPDATE_FIELDS.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `These fields cannot be changed here: ${unknown.join(', ')}. Use the dedicated permissions/scope/status/password endpoints.`
      );
    }
    return true;
  }),
  body('name').optional().isString().trim().isLength({ min: 1, max: 100 }),
  body('phone')
    .optional({ nullable: true })
    .isString()
    .trim()
    .matches(/^[0-9+\-\s()]{6,20}$/)
    .withMessage('Phone number is invalid.'),
  body('department').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('role').optional().isIn(MANAGEABLE_ROLES),
  body('status').optional().isIn(ALL_USER_STATUSES),
];

const updateStatusValidator = [
  idParam,
  body('status').isIn(ALL_USER_STATUSES).withMessage(`status must be one of: ${ALL_USER_STATUSES.join(', ')}.`),
];

const updatePermissionsValidator = [idParam, permissionsField];

const updateScopeValidator = [idParam, dataScopeField];

const resetPasswordValidator = [
  idParam,
  body('mode').optional().isIn(['SET_PASSWORD', 'EMAIL_LINK']).withMessage('mode must be SET_PASSWORD or EMAIL_LINK.'),
  body('newPassword')
    .if(body('mode').equals('SET_PASSWORD'))
    .isString()
    .custom((value) => isPasswordStrongEnough(value))
    .withMessage(PASSWORD_POLICY_MESSAGE),
];

const assignClientValidator = [idParam, body('clientId').isMongoId().withMessage('A valid clientId is required.')];

const bulkAssignClientValidator = [
  idParam,
  body('clientIds').isArray({ min: 1 }).withMessage('clientIds must be a non-empty array.'),
  body('clientIds.*').isMongoId().withMessage('Every clientId must be valid.'),
];

const unassignClientValidator = [idParam, clientIdParam];

module.exports = {
  MANAGEABLE_ROLES,
  idOnlyValidator,
  listAdminsValidator,
  createAdminValidator,
  updateAdminValidator,
  updateStatusValidator,
  updatePermissionsValidator,
  updateScopeValidator,
  resetPasswordValidator,
  assignClientValidator,
  bulkAssignClientValidator,
  unassignClientValidator,
};
