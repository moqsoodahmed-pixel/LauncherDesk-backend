const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requirePermission = require('../../middleware/portal/requirePermission');
const requireRole = require('../../middleware/portal/requireRole');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const { ROLES } = require('../../constants/portal/roles');
const invoiceService = require('../../services/portal/invoice.service');
const { sendSuccess } = require('../../utils/portal/apiResponse');

/**
 * Admin / Super Admin invoice management surface. The Client's own
 * invoice list/download lives in clientProfile.routes.js alongside their
 * other self-service endpoints - this router is the internal (staff-facing)
 * one, same split already used for /clients vs /client/*.
 */
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.VIEW_INVOICE), async (req, res, next) => {
  try {
    const { page, limit, search } = req.query;
    const result = await invoiceService.listInvoicesForAdmin({
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 20, 100),
      search,
    });
    return sendSuccess(res, { message: 'Invoices.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
});

// Order Details page ("Invoice Available") and Payments page both need to
// know, given an orderId, whether an invoice exists yet - without this,
// the frontend would have to fetch and filter the entire invoice list.
router.get('/order/:orderId', requirePermission(PERMISSIONS.VIEW_INVOICE), async (req, res, next) => {
  try {
    const invoice = await invoiceService.getInvoiceByOrder(req.params.orderId);
    return sendSuccess(res, { message: invoice ? 'Invoice.' : 'No invoice yet.', data: invoice });
  } catch (err) {
    next(err);
  }
});

router.get('/order/:orderId/versions', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const versions = await invoiceService.listInvoiceVersions(req.params.orderId);
    return sendSuccess(res, { message: 'Invoice version history.', data: versions });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/download', requirePermission(PERMISSIONS.DOWNLOAD_INVOICE), async (req, res, next) => {
  try {
    const { buffer, filename } = await invoiceService.getInvoiceFile(req.params.id, req.user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resend', requirePermission(PERMISSIONS.RESEND_INVOICE), async (req, res, next) => {
  try {
    await invoiceService.resendInvoiceEmail(req.params.id, req.user);
    return sendSuccess(res, { message: 'Invoice email resent.' });
  } catch (err) {
    next(err);
  }
});

// Regenerate and Delete are Super Admin-only, per the brief - requireRole
// here is intentionally stricter than a grantable permission, mirroring
// admins.routes.js's own Super-Admin-only router pattern.
router.post('/:id/regenerate', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const invoice = await invoiceService.regenerateInvoice(req.params.id, req.user);
    return sendSuccess(res, { message: 'Invoice regenerated.', data: invoiceService.serializeInvoice(invoice) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    await invoiceService.deleteInvoice(req.params.id, req.user);
    return sendSuccess(res, { message: 'Invoice deleted.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
