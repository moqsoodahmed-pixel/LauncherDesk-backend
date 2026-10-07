const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const validateRequest = require('../../middleware/portal/validateRequest');
const { scopeOrders, buildOrderScopeFilter, loadScoped } = require('../../middleware/portal/dataScope');
const { ROLES } = require('../../constants/portal/roles');
const { Order } = require('../../models/portal');
const ordersController = require('../../controllers/portal/orders.controller');
const kycController = require('../../controllers/portal/kyc.controller');
const { kycFileUpload, handleUploadErrors } = require('../../middleware/portal/kycUpload');
const paymentController = require('../../controllers/portal/payment.controller');
const communicationsController = require('../../controllers/portal/communications.controller');
const { idOnlyValidator, listClientOrdersValidator, createClientOrderValidator, cancelValidator } = require('../../validators/portal/orders.validators');
const { uploadDocumentValidator, documentActionValidator, orderIdOnlyValidator } = require('../../validators/portal/kyc.validators');
const { createPaymentOrderValidator, verifyPaymentValidator, reportFailureValidator } = require('../../validators/portal/payment.validators');

/**
 * Client self-service order endpoints - mounted at /api/client/orders,
 * alongside /api/client/profile and /api/client/services. Reuses the same
 * scopeOrders/loadScoped IDOR-safe machinery as the internal
 * /api/orders router (Phase 1) and the same orders.service.js (no
 * duplicated business logic) - only the surface and the role gate differ.
 * A Client here has no `:id` path for listing (scopeOrders already
 * restricts them to `{ client: user.clientProfile }`), and the single-order
 * loader below applies that same restriction before a CLIENT request can
 * ever reach a specific order. There is deliberately no assign/reassign/
 * status/close route here at all - a Client has no way to reach them.
 */
router.use(authenticate, requireRole(ROLES.CLIENT), scopeOrders);

const loadOwnOrder = loadScoped(Order, buildOrderScopeFilter);

router.get('/', listClientOrdersValidator, validateRequest, ordersController.list);
router.post('/', createClientOrderValidator, validateRequest, ordersController.createForClient);
router.get('/:id', idOnlyValidator, validateRequest, loadOwnOrder, ordersController.getById);

// Client-safe shape only: { status, label, createdAt } - never the raw
// OrderStatusHistory document (which carries an internal changedBy user id
// and a possibly staff-only reason). See orders.service.getClientOrderStatusHistory.
router.get('/:id/status-history', idOnlyValidator, validateRequest, loadOwnOrder, ordersController.getClientStatusHistory);

// Narrower than the internal CANCEL_ORDER-gated endpoint: only while the
// order is still in CLIENT_CANCELLABLE_STATUSES (before any Admin has
// started work) - see constants/orderStatus.js and
// orders.service.cancelOwnOrder for the enforced rule.
router.patch('/:id/cancel', cancelValidator, validateRequest, loadOwnOrder, ordersController.cancelOwn);

// KYC - client self-service upload/status surface. loadOwnOrder already
// guarantees the order belongs to this client before any of these run.
router.get('/:id/kyc', orderIdOnlyValidator, validateRequest, loadOwnOrder, kycController.getSummary);
router.get('/:id/kyc/documents', orderIdOnlyValidator, validateRequest, loadOwnOrder, kycController.listDocuments);
router.post(
  '/:id/kyc/documents',
  idOnlyValidator,
  validateRequest,
  loadOwnOrder,
  kycFileUpload,
  handleUploadErrors,
  uploadDocumentValidator,
  validateRequest,
  kycController.upload
);
router.get(
  '/:id/kyc/documents/:documentId/download',
  documentActionValidator,
  validateRequest,
  loadOwnOrder,
  kycController.download
);
router.post('/:id/kyc/submit', orderIdOnlyValidator, validateRequest, loadOwnOrder, kycController.submit);

// Client-safe communication status only (no provider internals) - Phase 9.
router.get('/:id/communications', idOnlyValidator, validateRequest, loadOwnOrder, communicationsController.listForOwnOrder);

// Payment (Phase 8) - client self-service. Amount/currency always come
// from the already-loaded order's own pricing snapshot server-side; the
// client never supplies or influences them.
router.post('/:id/payment/create', createPaymentOrderValidator, validateRequest, loadOwnOrder, paymentController.createOrder);
router.post('/:id/payment/verify', verifyPaymentValidator, validateRequest, loadOwnOrder, paymentController.verify);
router.post('/:id/payment/failed', reportFailureValidator, validateRequest, loadOwnOrder, paymentController.reportFailure);
router.get('/:id/payment', idOnlyValidator, validateRequest, loadOwnOrder, paymentController.getOwnPaymentStatus);

// Document requests — client sees pending requests so they know what to upload
const { clientRouter: docReqClientRouter } = require('./docRequests.routes');
router.use('/:orderId/doc-requests', docReqClientRouter);

module.exports = router;
