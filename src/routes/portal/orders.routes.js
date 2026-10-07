const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const requirePermission = require('../../middleware/portal/requirePermission');
const { requireAnyPermission } = require('../../middleware/portal/requirePermission');
const validateRequest = require('../../middleware/portal/validateRequest');
const { scopeOrders, buildOrderScopeFilter, loadScoped } = require('../../middleware/portal/dataScope');
const { ROLES } = require('../../constants/portal/roles');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const { Order } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const env = require('../../config/portal');
const ordersController = require('../../controllers/portal/orders.controller');
const kycController = require('../../controllers/portal/kyc.controller');
const paymentController = require('../../controllers/portal/payment.controller');
const { refundValidator } = require('../../validators/portal/payment.validators');
const {
  idOnlyValidator,
  listOrdersValidator,
  createOrderValidator,
  updateOrderValidator,
  updateStatusValidator,
  assignValidator,
  cancelValidator,
  closeValidator,
  paymentStatusValidator,
  devAdvanceValidator,
} = require('../../validators/portal/orders.validators');
const {
  uploadDocumentValidator,
  documentActionValidator,
  rejectDocumentValidator,
  orderIdOnlyValidator,
} = require('../../validators/portal/kyc.validators');

// Internal order management (Super Admin / Admin). Client self-service
// order endpoints live in routes/clientOrders.routes.js instead, mounted
// at /api/client/orders - same underlying service, different surface.
router.use(authenticate, scopeOrders);

// loadOrder is the same IDOR-safe loader used everywhere else: the id and
// the caller's order scope filter (buildOrderScopeFilter - unchanged from
// Phase 1) go into one query, so an order outside an Admin's scope 404s
// exactly like a nonexistent id.
const loadOrder = loadScoped(Order, buildOrderScopeFilter);

// Decorated loader that also populates assignedAdmin for detail views.
function loadOrderWithAdmin(req, res, next) {
  loadOrder(req, res, async (err) => {
    if (err) return next(err);
    try {
      await req.resource.populate('assignedAdmin', 'name email adminCode');
      next();
    } catch (e) {
      next(e);
    }
  });
}

router.get(
  '/',
  requireAnyPermission(PERMISSIONS.VIEW_ORDER, PERMISSIONS.VIEW_OWN_ORDERS),
  listOrdersValidator,
  validateRequest,
  ordersController.list
);
router.post('/', requirePermission(PERMISSIONS.CREATE_ORDER), createOrderValidator, validateRequest, ordersController.create);

router.get(
  '/:id',
  requireAnyPermission(PERMISSIONS.VIEW_ORDER, PERMISSIONS.VIEW_OWN_ORDERS),
  idOnlyValidator,
  validateRequest,
  loadOrderWithAdmin,
  ordersController.getById
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.EDIT_ORDER),
  updateOrderValidator,
  validateRequest,
  loadOrder,
  ordersController.update
);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.UPDATE_ORDER_STATUS),
  updateStatusValidator,
  validateRequest,
  loadOrder,
  ordersController.updateStatus
);
router.patch('/:id/cancel', requirePermission(PERMISSIONS.CANCEL_ORDER), cancelValidator, validateRequest, loadOrder, ordersController.cancel);
router.patch('/:id/close', requirePermission(PERMISSIONS.CLOSE_ORDER), closeValidator, validateRequest, loadOrder, ordersController.close);

// DEVELOPMENT/TESTING ONLY - see services/orders.service.js.devAdvanceStatus
// and orders.service.js.updatePaymentStatus. Hard-disabled outside
// development so neither can ever run against a production deployment.
router.patch('/:id/dev-advance-status', requireRole(ROLES.SUPER_ADMIN), (req, res, next) => {
  if (env.isProduction) return next(AppError.notFound());
  return next();
}, devAdvanceValidator, validateRequest, loadOrder, ordersController.devAdvance);

router.patch(
  '/:id/payment-status',
  requirePermission(PERMISSIONS.UPDATE_ORDER_STATUS),
  (req, res, next) => {
    if (env.isProduction) return next(AppError.notFound());
    return next();
  },
  paymentStatusValidator,
  validateRequest,
  loadOrder,
  ordersController.updatePaymentStatus
);

router.patch('/:id/assign', requirePermission(PERMISSIONS.ASSIGN_ORDER), assignValidator, validateRequest, loadOrder, ordersController.assign);
router.patch(
  '/:id/reassign',
  requirePermission(PERMISSIONS.REASSIGN_ORDER),
  assignValidator,
  validateRequest,
  loadOrder,
  ordersController.reassign
);
router.delete(
  '/:id/assignment',
  requirePermission(PERMISSIONS.REASSIGN_ORDER),
  idOnlyValidator,
  validateRequest,
  loadOrder,
  ordersController.unassign
);

router.get(
  '/:id/status-history',
  requireAnyPermission(PERMISSIONS.VIEW_ORDER, PERMISSIONS.VIEW_OWN_ORDERS),
  idOnlyValidator,
  validateRequest,
  loadOrder,
  ordersController.getStatusHistory
);
router.get(
  '/:id/assignment-history',
  requirePermission(PERMISSIONS.VIEW_ORDER),
  idOnlyValidator,
  validateRequest,
  loadOrder,
  ordersController.getAssignmentHistory
);
router.get(
  '/:id/activity',
  requirePermission(PERMISSIONS.VIEW_AUDIT_LOGS),
  idOnlyValidator,
  validateRequest,
  loadOrder,
  ordersController.getActivity
);

// KYC - internal review surface. Document upload is a client-only action
// (routes/clientOrders.routes.js); internal staff only list/review/decide.
router.get(
  '/:id/kyc',
  requireAnyPermission(PERMISSIONS.VIEW_KYC, PERMISSIONS.VIEW_OWN_DOCUMENTS),
  orderIdOnlyValidator,
  validateRequest,
  loadOrder,
  kycController.getSummary
);
router.get(
  '/:id/kyc/documents',
  requireAnyPermission(PERMISSIONS.VIEW_KYC, PERMISSIONS.VIEW_OWN_DOCUMENTS),
  orderIdOnlyValidator,
  validateRequest,
  loadOrder,
  kycController.listDocuments
);
router.get(
  '/:id/kyc/documents/:documentId/download',
  requireAnyPermission(PERMISSIONS.DOWNLOAD_KYC, PERMISSIONS.VIEW_OWN_DOCUMENTS),
  documentActionValidator,
  validateRequest,
  loadOrder,
  kycController.download
);
router.patch(
  '/:id/kyc/documents/:documentId/verify',
  requirePermission(PERMISSIONS.VERIFY_KYC),
  documentActionValidator,
  validateRequest,
  loadOrder,
  kycController.verify
);
router.patch(
  '/:id/kyc/documents/:documentId/reject',
  requirePermission(PERMISSIONS.REJECT_KYC),
  rejectDocumentValidator,
  validateRequest,
  loadOrder,
  kycController.reject
);
router.post(
  '/:id/kyc/review',
  requirePermission(PERMISSIONS.VERIFY_KYC),
  orderIdOnlyValidator,
  validateRequest,
  loadOrder,
  kycController.startReview
);

// Payment (Phase 8) - internal visibility/admin actions only. No
// create/verify routes here - those are exclusively client self-service
// (routes/clientOrders.routes.js), since only the paying client's own
// checkout session can produce a valid signature.
router.get(
  '/:id/payment',
  requireAnyPermission(PERMISSIONS.VIEW_PAYMENT, PERMISSIONS.VIEW_PAYMENT_DETAILS),
  idOnlyValidator,
  validateRequest,
  loadOrder,
  paymentController.getForOrder
);
router.post(
  '/:id/payment/refund',
  requirePermission(PERMISSIONS.REFUND_PAYMENT),
  refundValidator,
  validateRequest,
  loadOrder,
  paymentController.refund
);
router.post(
  '/:id/payment/reconcile',
  requirePermission(PERMISSIONS.VIEW_PAYMENT_DETAILS),
  idOnlyValidator,
  validateRequest,
  loadOrder,
  paymentController.reconcile
);

// Priority update
router.patch('/:id/priority', requirePermission(PERMISSIONS.EDIT_ORDER), async (req, res, next) => {
  try {
    const { Order: OrderModel } = require('../../models/portal');
    const { sendSuccess } = require('../../utils/portal/apiResponse');
    const VALID = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'URGENT'];
    const { priority } = req.body;
    if (!VALID.includes(priority)) return next(require('../../utils/portal/AppError').badRequest(`priority must be one of ${VALID.join(', ')}.`));
    const order = await OrderModel.findByIdAndUpdate(req.params.id, { priority }, { new: true });
    if (!order) return next(require('../../utils/portal/AppError').notFound('Order not found.'));
    sendSuccess(res, { message: 'Priority updated.', data: { priority: order.priority } });
  } catch (err) { next(err); }
});

// Internal notes (staff only — nested)
router.use('/:orderId/notes', require('./internalNotes.routes'));

// Document requests
const { staffRouter: docReqStaffRouter } = require('./docRequests.routes');
router.use('/:orderId/doc-requests', docReqStaffRouter);

module.exports = router;
