const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requirePermission = require('../../middleware/portal/requirePermission');
const validateRequest = require('../../middleware/portal/validateRequest');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const communicationsController = require('../../controllers/portal/communications.controller');
const { listCommunicationsValidator } = require('../../validators/portal/communications.validators');

/**
 * Internal communication visibility - reuses the existing
 * VIEW_NOTIFICATIONS permission rather than adding a new one (Phase 9
 * spec §45). Scope is enforced inside communicationQuery.service.js via
 * the same buildOrderScopeFilter every other order-scoped query uses -
 * no parallel scope engine.
 */
router.use(authenticate, requirePermission(PERMISSIONS.VIEW_NOTIFICATIONS));

router.get('/', listCommunicationsValidator, validateRequest, communicationsController.list);

module.exports = router;
