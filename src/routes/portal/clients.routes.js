const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const requirePermission = require('../../middleware/portal/requirePermission');
const validateRequest = require('../../middleware/portal/validateRequest');
const { scopeClients, buildClientScopeFilter, loadScoped } = require('../../middleware/portal/dataScope');
const { ROLES } = require('../../constants/portal/roles');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const { Client } = require('../../models/portal');
const clientsController = require('../../controllers/portal/clients.controller');
const {
  idOnlyValidator,
  listClientsValidator,
  createClientValidator,
  updateClientValidator,
  updateStatusValidator,
  assignValidator,
  archiveValidator,
} = require('../../validators/portal/clients.validators');

// Client Management (internal, Admin/Super Admin side) - the CLIENT role's
// own self-service profile lives in routes/clientProfile.routes.js instead.
router.use(authenticate, requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN), scopeClients);

router.get('/', requirePermission(PERMISSIONS.VIEW_CLIENT), listClientsValidator, validateRequest, clientsController.list);
router.post('/', requirePermission(PERMISSIONS.CREATE_CLIENT), createClientValidator, validateRequest, clientsController.create);

// Every single-record route below loads its target through the same
// IDOR-safe loadScoped() helper used elsewhere: the id and the caller's
// data-scope filter are applied in ONE query, so a client outside an
// Admin's scope 404s exactly like a nonexistent id - no existence oracle.
const loadClient = loadScoped(Client, buildClientScopeFilter);

router.get('/:id', requirePermission(PERMISSIONS.VIEW_CLIENT), idOnlyValidator, validateRequest, loadClient, clientsController.getById);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.EDIT_CLIENT),
  updateClientValidator,
  validateRequest,
  loadClient,
  clientsController.update
);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.EDIT_CLIENT),
  updateStatusValidator,
  validateRequest,
  loadClient,
  clientsController.updateStatus
);
router.delete('/:id', requirePermission(PERMISSIONS.DELETE_CLIENT), archiveValidator, validateRequest, loadClient, clientsController.archive);

router.post(
  '/:id/assign',
  requirePermission(PERMISSIONS.ASSIGN_CLIENT),
  assignValidator,
  validateRequest,
  loadClient,
  clientsController.assign
);
router.post(
  '/:id/reassign',
  requirePermission(PERMISSIONS.REASSIGN_CLIENT),
  assignValidator,
  validateRequest,
  loadClient,
  clientsController.reassign
);
router.delete(
  '/:id/assignment',
  requirePermission(PERMISSIONS.REASSIGN_CLIENT),
  idOnlyValidator,
  validateRequest,
  loadClient,
  clientsController.unassign
);
router.get(
  '/:id/assignment-history',
  requirePermission(PERMISSIONS.VIEW_CLIENT),
  idOnlyValidator,
  validateRequest,
  loadClient,
  clientsController.getAssignmentHistory
);

router.get(
  '/:id/activity',
  requirePermission(PERMISSIONS.VIEW_AUDIT_LOGS),
  idOnlyValidator,
  validateRequest,
  loadClient,
  clientsController.getActivity
);

module.exports = router;
