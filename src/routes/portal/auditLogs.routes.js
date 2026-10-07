const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requirePermission = require('../../middleware/portal/requirePermission');
const validateRequest = require('../../middleware/portal/validateRequest');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const auditLogsController = require('../../controllers/portal/auditLogs.controller');
const { listAuditLogsValidator } = require('../../validators/portal/auditLogs.validators');

router.use(authenticate, requirePermission(PERMISSIONS.VIEW_AUDIT_LOGS));

// Read-only by design - no PUT/PATCH/DELETE route exists or should ever
// be added for audit logs. The AuditLog model itself also blocks every
// mutation/deletion path at the Mongoose layer (see AuditLog.model.js).
router.get('/', listAuditLogsValidator, validateRequest, auditLogsController.list);

module.exports = router;
