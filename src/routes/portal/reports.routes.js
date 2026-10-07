const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requirePermission = require('../../middleware/portal/requirePermission');
const validateRequest = require('../../middleware/portal/validateRequest');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const reportsController = require('../../controllers/portal/reports.controller');
const { reportQueryValidator } = require('../../validators/portal/reports.validators');

/**
 * Internal management reporting only - Clients never reach this router at
 * all (CLIENT_PERMISSIONS has neither VIEW_REPORTS nor EXPORT_REPORTS, so
 * requirePermission below already fails closed for them; no additional
 * client-specific check is needed here). Admin access is scoped inside
 * reports.service.js via the SAME buildOrderScopeFilter/buildClientScopeFilter
 * every other module uses - no parallel scope engine.
 */
router.use(authenticate, requirePermission(PERMISSIONS.VIEW_REPORTS));

router.get('/overview', reportQueryValidator, validateRequest, reportsController.overview);
router.get('/orders', reportQueryValidator, validateRequest, reportsController.orders);
router.get('/revenue', reportQueryValidator, validateRequest, reportsController.revenue);
router.get('/services', reportQueryValidator, validateRequest, reportsController.services);
router.get('/clients', reportQueryValidator, validateRequest, reportsController.clients);
router.get('/admins', reportQueryValidator, validateRequest, reportsController.admins);
router.get('/kyc', reportQueryValidator, validateRequest, reportsController.kyc);
router.get('/payments', reportQueryValidator, validateRequest, reportsController.payments);
router.get('/communications', reportQueryValidator, validateRequest, reportsController.communications);
router.get('/funnel', reportQueryValidator, validateRequest, reportsController.funnel);
router.get('/support', reportQueryValidator, validateRequest, reportsController.supportTickets);
router.get('/tasks', reportQueryValidator, validateRequest, reportsController.tasks);

// CSV exports - gated by the separate EXPORT_REPORTS permission.
router.get(
  '/orders/export',
  requirePermission(PERMISSIONS.EXPORT_REPORTS),
  reportQueryValidator,
  validateRequest,
  reportsController.exportOrders
);
router.get(
  '/revenue/export',
  requirePermission(PERMISSIONS.EXPORT_REPORTS),
  reportQueryValidator,
  validateRequest,
  reportsController.exportRevenue
);
router.get(
  '/services/export',
  requirePermission(PERMISSIONS.EXPORT_REPORTS),
  reportQueryValidator,
  validateRequest,
  reportsController.exportServices
);

module.exports = router;
