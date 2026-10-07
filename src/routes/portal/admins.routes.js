const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const requirePermission = require('../../middleware/portal/requirePermission');
const validateRequest = require('../../middleware/portal/validateRequest');
const { ROLES } = require('../../constants/portal/roles');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const adminsController = require('../../controllers/portal/admins.controller');
const {
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
} = require('../../validators/portal/admins.validators');

// Admin management is exclusively a Super Admin capability. This single
// role gate is also what keeps a normal Admin from ever reaching these
// routes to promote themselves or create a Super Admin - the permission
// checks below are defence in depth on top of it, not the only barrier.
router.use(authenticate, requireRole(ROLES.SUPER_ADMIN));

router.get('/', requirePermission(PERMISSIONS.VIEW_ADMINS), listAdminsValidator, validateRequest, adminsController.list);
router.post('/', requirePermission(PERMISSIONS.CREATE_ADMIN), createAdminValidator, validateRequest, adminsController.create);
router.get('/:id', requirePermission(PERMISSIONS.VIEW_ADMINS), idOnlyValidator, validateRequest, adminsController.getById);
router.patch('/:id', requirePermission(PERMISSIONS.EDIT_ADMIN), updateAdminValidator, validateRequest, adminsController.update);

router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.DISABLE_ADMIN),
  updateStatusValidator,
  validateRequest,
  adminsController.updateStatus
);

router.get('/:id/permissions', requirePermission(PERMISSIONS.VIEW_ADMINS), idOnlyValidator, validateRequest, adminsController.getPermissions);
router.patch(
  '/:id/permissions',
  requirePermission(PERMISSIONS.MANAGE_ADMIN_PERMISSIONS),
  updatePermissionsValidator,
  validateRequest,
  adminsController.updatePermissions
);

router.patch(
  '/:id/scope',
  requirePermission(PERMISSIONS.MANAGE_ADMIN_PERMISSIONS),
  updateScopeValidator,
  validateRequest,
  adminsController.updateScope
);

router.post(
  '/:id/reset-password',
  requirePermission(PERMISSIONS.EDIT_ADMIN),
  resetPasswordValidator,
  validateRequest,
  adminsController.resetPassword
);

router.get('/:id/sessions', requirePermission(PERMISSIONS.VIEW_ADMINS), idOnlyValidator, validateRequest, adminsController.getSessions);
router.post(
  '/:id/revoke-sessions',
  requirePermission(PERMISSIONS.EDIT_ADMIN),
  idOnlyValidator,
  validateRequest,
  adminsController.revokeSessions
);

router.get('/:id/activity', requirePermission(PERMISSIONS.VIEW_AUDIT_LOGS), idOnlyValidator, validateRequest, adminsController.getActivity);
router.get('/:id/stats', requirePermission(PERMISSIONS.VIEW_ADMINS), idOnlyValidator, validateRequest, adminsController.getStats);

router.get('/:id/clients', requirePermission(PERMISSIONS.ASSIGN_ADMIN_CLIENTS), idOnlyValidator, validateRequest, adminsController.listClients);
router.post(
  '/:id/clients',
  requirePermission(PERMISSIONS.ASSIGN_ADMIN_CLIENTS),
  assignClientValidator,
  validateRequest,
  adminsController.assignClient
);
router.post(
  '/:id/clients/bulk-assign',
  requirePermission(PERMISSIONS.ASSIGN_ADMIN_CLIENTS),
  bulkAssignClientValidator,
  validateRequest,
  adminsController.bulkAssignClients
);
router.delete(
  '/:id/clients/:clientId',
  requirePermission(PERMISSIONS.ASSIGN_ADMIN_CLIENTS),
  unassignClientValidator,
  validateRequest,
  adminsController.unassignClient
);

module.exports = router;
