const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requirePermission = require('../../middleware/portal/requirePermission');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const adminKycService = require('../../services/portal/adminKyc.service');
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

module.exports = router;
