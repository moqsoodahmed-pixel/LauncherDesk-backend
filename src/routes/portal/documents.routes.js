const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requirePermission = require('../../middleware/portal/requirePermission');
const { requireAnyPermission } = require('../../middleware/portal/requirePermission');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const { notImplemented } = require('../../controllers/portal/notImplemented.controller');

router.use(authenticate);

// Document binary access always goes through this authorized endpoint -
// never a public static file URL. Real implementation (ownership check
// against the document's own clientId) lands in Phase 7.
router.get('/:id', requireAnyPermission(PERMISSIONS.DOWNLOAD_KYC, PERMISSIONS.VIEW_OWN_DOCUMENTS), notImplemented('Secure document retrieval', 'Phase 7'));
router.delete('/:id', requirePermission(PERMISSIONS.DELETE_KYC), notImplemented('Document deletion', 'Phase 7'));

module.exports = router;
