const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requirePermission = require('../../middleware/portal/requirePermission');
const validateRequest = require('../../middleware/portal/validateRequest');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const { Service } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const servicesController = require('../../controllers/portal/services.controller');
const {
  idOnlyValidator,
  listServicesValidator,
  createServiceValidator,
  updateServiceValidator,
  updateStatusValidator,
  updateFormSchemaValidator,
  updateDocumentsValidator,
} = require('../../validators/portal/services.validators');

/**
 * Services are a global catalogue, not scoped per-Admin like Clients/Orders
 * - every permitted user sees the same set of services. The permission
 * check alone (VIEW_SERVICE / CREATE_SERVICE / ...) is the access control
 * here; there is no additional data-scope layer to apply. Not scoping by
 * the caller is deliberate, not an oversight.
 */
function loadService(req, res, next) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return next(AppError.notFound());
  }
  Service.findById(id)
    .then((service) => {
      if (!service) return next(AppError.notFound());
      req.resource = service;
      next();
    })
    .catch(next);
}

router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.VIEW_SERVICE), listServicesValidator, validateRequest, servicesController.list);
router.post('/', requirePermission(PERMISSIONS.CREATE_SERVICE), createServiceValidator, validateRequest, servicesController.create);

router.get('/:id', requirePermission(PERMISSIONS.VIEW_SERVICE), idOnlyValidator, validateRequest, loadService, servicesController.getById);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.EDIT_SERVICE),
  updateServiceValidator,
  validateRequest,
  loadService,
  servicesController.update
);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.EDIT_SERVICE),
  updateStatusValidator,
  validateRequest,
  loadService,
  servicesController.updateStatus
);
router.delete('/:id', requirePermission(PERMISSIONS.DELETE_SERVICE), idOnlyValidator, validateRequest, loadService, servicesController.archive);

router.patch(
  '/:id/form-schema',
  requirePermission(PERMISSIONS.EDIT_SERVICE),
  updateFormSchemaValidator,
  validateRequest,
  loadService,
  servicesController.updateFormSchema
);
router.patch(
  '/:id/documents',
  requirePermission(PERMISSIONS.EDIT_SERVICE),
  updateDocumentsValidator,
  validateRequest,
  loadService,
  servicesController.updateDocuments
);

router.get(
  '/:id/activity',
  requirePermission(PERMISSIONS.VIEW_AUDIT_LOGS),
  idOnlyValidator,
  validateRequest,
  loadService,
  servicesController.getActivity
);

module.exports = router;
