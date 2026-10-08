const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requirePermission = require('../../middleware/portal/requirePermission');
const validateRequest = require('../../middleware/portal/validateRequest');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const adminKycService = require('../../services/portal/adminKyc.service');
const kycController = require('../../controllers/portal/kyc.controller');
const { assignReviewerValidator, exportClientValidator } = require('../../validators/portal/kyc.validators');
const { sendSuccess } = require('../../utils/portal/apiResponse');

router.use(authenticate);

// Global KYC document list with stats — Super Admin / Admin dashboard
router.get('/stats', requirePermission(PERMISSIONS.VIEW_KYC), async (req, res, next) => {
  try {
    const stats = await adminKycService.getKycStats();
    return sendSuccess(res, { message: 'KYC stats.', data: stats });
  } catch (err) {
    next(err);
  }
});

router.get('/', requirePermission(PERMISSIONS.VIEW_KYC), async (req, res, next) => {
  try {
    const { page, limit, sortBy, sortDir, status, documentType, dateFrom, dateTo, search } = req.query;
    const result = await adminKycService.listKycDocuments({
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 20, 100),
      sortBy,
      sortDir,
      status,
      documentType,
      dateFrom,
      dateTo,
      search,
    });
    return sendSuccess(res, { message: 'KYC documents.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
});

// ── Wave 2 (admin/super-admin KYC workflows) additions - all additive ─────

// Assign a reviewer to a document - lives on this admin-wide surface
// (not order-nested) since the global KYC list/stats above are too.
// Judgment call: gated by VERIFY_KYC (the existing "reviews documents"
// permission) rather than a new permission, since assigning a reviewer is
// itself a review-management action and no dedicated permission exists for
// it per the brief's instruction to check existing permissions first.
router.patch(
  '/:documentId/assign-reviewer',
  requirePermission(PERMISSIONS.VERIFY_KYC),
  assignReviewerValidator,
  validateRequest,
  kycController.assignReviewer
);

// Bulk export (ZIP or CSV manifest, ?format=csv) of every current KYC
// document for a given client across ALL their orders - the client-wide
// sibling of the per-order export on orders.routes.js. Gated by
// DOWNLOAD_KYC for consistency with every other KYC download gate.
router.get(
  '/export/client/:clientId',
  requirePermission(PERMISSIONS.DOWNLOAD_KYC),
  exportClientValidator,
  validateRequest,
  kycController.exportClientKyc
);

module.exports = router;
