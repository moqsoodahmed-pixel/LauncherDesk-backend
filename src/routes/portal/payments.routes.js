const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requirePermission = require('../../middleware/portal/requirePermission');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const { notImplemented } = require('../../controllers/portal/notImplemented.controller');
const adminPaymentsService = require('../../services/portal/adminPayments.service');
const { sendSuccess } = require('../../utils/portal/apiResponse');

router.use(authenticate);

// List all payments (admin/super-admin)
router.get('/', requirePermission(PERMISSIONS.VIEW_PAYMENT), async (req, res, next) => {
  try {
    const { page, limit, sortBy, sortDir, search, status, method, provider, dateFrom, dateTo, clientId } = req.query;
    const result = await adminPaymentsService.listPayments({
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 20, 100),
      sortBy,
      sortDir,
      search,
      status,
      method,
      provider,
      dateFrom,
      dateTo,
      clientId,
    });
    return sendSuccess(res, { message: 'Payments.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
});

// Payment detail
router.get('/:id', requirePermission(PERMISSIONS.VIEW_PAYMENT_DETAILS), async (req, res, next) => {
  try {
    const payment = await adminPaymentsService.getPaymentById(req.params.id);
    return sendSuccess(res, { message: 'Payment.', data: payment });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/refund', requirePermission(PERMISSIONS.REFUND_PAYMENT), notImplemented('Payment refund', 'Phase 8'));
router.post('/razorpay/webhook', notImplemented('Razorpay webhook handling', 'Phase 8'));

module.exports = router;
