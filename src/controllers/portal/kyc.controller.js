const kycService = require('../../services/portal/kyc.service');
const kycState = require('../../services/portal/kycState.service');
const kycOrderReviewService = require('../../services/portal/kycOrderReview.service');
const kycCommentsService = require('../../services/portal/kycComments.service');
const { logAudit } = require('../../services/portal/auditLog.service');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { MAX_BULK_DOCUMENTS } = require('../../validators/portal/kyc.validators');
const { sendSuccess } = require('../../utils/portal/apiResponse');
const AppError = require('../../utils/portal/AppError');
const { ROLES } = require('../../constants/portal/roles');

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

function isClientReq(req) {
  return req.user.role === ROLES.CLIENT;
}

function serializeDoc(doc, req) {
  return isClientReq(req) ? kycService.serializeDocumentForClient(doc) : kycService.serializeDocument(doc);
}

async function getSummary(req, res, next) {
  try {
    const summary = await kycService.getOrderKycSummary(req.resource);
    return sendSuccess(res, { message: 'KYC status.', data: summary });
  } catch (err) {
    next(err);
  }
}

async function listDocuments(req, res, next) {
  try {
    const includeAllVersions = !isClientReq(req) && req.query.allVersions === 'true';
    const documents = await kycService.listDocuments(req.resource._id, { includeAllVersions });
    return sendSuccess(res, { message: 'KYC documents.', data: documents.map((d) => serializeDoc(d, req)) });
  } catch (err) {
    next(err);
  }
}

async function upload(req, res, next) {
  try {
    if (!req.file) {
      return next(AppError.badRequest('A file is required.'));
    }
    const doc = await kycService.uploadDocument({
      order: req.resource,
      documentType: req.body.documentType,
      file: req.file,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, { statusCode: 201, message: 'Document uploaded.', data: serializeDoc(doc, req) });
  } catch (err) {
    next(err);
  }
}

async function download(req, res, next) {
  try {
    const requireClientId = isClientReq(req) ? req.user.clientProfile : null;
    const { buffer, mimeType, originalFileName } = await kycService.getDocumentForDownload({
      order: req.resource,
      documentId: req.params.documentId,
      actor: req.user,
      requireClientId,
      meta: requestMeta(req),
    });

    // Sanitize the filename placed into the header - strip quotes/control
    // characters so it can never inject extra header directives.
    const safeName = originalFileName.replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
}

async function verify(req, res, next) {
  try {
    const { document, order } = await kycService.verifyDocument({
      order: req.resource,
      documentId: req.params.documentId,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, {
      message: 'Document verified.',
      data: { document: kycService.serializeDocument(document), orderStatus: order.status },
    });
  } catch (err) {
    next(err);
  }
}

async function reject(req, res, next) {
  try {
    const { document, order } = await kycService.rejectDocument({
      order: req.resource,
      documentId: req.params.documentId,
      reason: req.body.reason,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, {
      message: 'Document rejected.',
      data: { document: kycService.serializeDocument(document), orderStatus: order.status },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Wave 2 addition: a route/controller for kyc.service.js's requestReupload
 * (built in Wave 1 as a service function only - no route ever called it,
 * confirmed by grepping routes/ and controllers/ for any reference before
 * this change). Mirrors reject's controller exactly; the only behavioral
 * difference is inside the service (NEED_REUPLOAD instead of REJECTED).
 */
async function requestReupload(req, res, next) {
  try {
    const { document, order } = await kycService.requestReupload({
      order: req.resource,
      documentId: req.params.documentId,
      reason: req.body.reason,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, {
      message: 'Re-upload requested.',
      data: { document: kycService.serializeDocument(document), orderStatus: order.status },
    });
  } catch (err) {
    next(err);
  }
}

async function submit(req, res, next) {
  try {
    const order = await kycState.submitForReview(req.resource, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'KYC submitted for review.', data: { orderStatus: order.status } });
  } catch (err) {
    next(err);
  }
}

async function startReview(req, res, next) {
  try {
    const order = await kycState.startReview(req.resource, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'KYC review started.', data: { orderStatus: order.status } });
  } catch (err) {
    next(err);
  }
}

// ── Wave 2 (admin/super-admin KYC workflows) additions - all additive ──────

/** Order-level "approve complete KYC" (distinct from per-document verify). */
async function approveOrderKyc(req, res, next) {
  try {
    const order = await kycOrderReviewService.approveCompleteKyc({
      order: req.resource,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, { message: 'Order KYC approved.', data: { orderStatus: order.status } });
  } catch (err) {
    next(err);
  }
}

/** Order-level "reject complete KYC" (distinct from per-document reject). */
async function rejectOrderKyc(req, res, next) {
  try {
    const order = await kycOrderReviewService.rejectCompleteKyc({
      order: req.resource,
      actor: req.user,
      reason: req.body.reason,
      meta: requestMeta(req),
    });
    return sendSuccess(res, { message: 'Order KYC rejected.', data: { orderStatus: order.status } });
  } catch (err) {
    next(err);
  }
}

/** Super Admin-only force approve - bypasses the KYC_VERIFICATION order-status guard. */
async function forceVerify(req, res, next) {
  try {
    const { document, order } = await kycService.forceApproveDocument({
      order: req.resource,
      documentId: req.params.documentId,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, {
      message: 'Document force-approved.',
      data: { document: kycService.serializeDocument(document), orderStatus: order.status },
    });
  } catch (err) {
    next(err);
  }
}

/** Super Admin-only force reject - bypasses the KYC_VERIFICATION order-status guard. */
async function forceReject(req, res, next) {
  try {
    const { document, order } = await kycService.forceRejectDocument({
      order: req.resource,
      documentId: req.params.documentId,
      reason: req.body.reason,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, {
      message: 'Document force-rejected.',
      data: { document: kycService.serializeDocument(document), orderStatus: order.status },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Bulk verify/reject: applies the existing single-document verify/reject
 * logic to each id in the array, in a loop, with each call individually
 * wrapped so one failure never aborts/discards the rest of the batch.
 */
async function bulkDecide(req, res, next, { action }) {
  try {
    const documentIds = req.body.documentIds || [];
    if (documentIds.length > MAX_BULK_DOCUMENTS) {
      return next(AppError.badRequest(`A maximum of ${MAX_BULK_DOCUMENTS} documents may be processed at once.`));
    }

    const results = [];
    for (const documentId of documentIds) {
      try {
        const { document, order } =
          action === 'verify'
            ? await kycService.verifyDocument({ order: req.resource, documentId, actor: req.user, meta: requestMeta(req) })
            : await kycService.rejectDocument({ order: req.resource, documentId, reason: req.body.reason, actor: req.user, meta: requestMeta(req) });
        results.push({ documentId, success: true, status: document.status, orderStatus: order.status });
      } catch (err) {
        results.push({ documentId, success: false, error: err.message || 'Failed.' });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    return sendSuccess(res, {
      message: `Bulk ${action}: ${succeeded}/${results.length} succeeded.`,
      data: { results, succeeded, failed: results.length - succeeded },
    });
  } catch (err) {
    next(err);
  }
}

async function bulkVerify(req, res, next) {
  return bulkDecide(req, res, next, { action: 'verify' });
}

async function bulkReject(req, res, next) {
  return bulkDecide(req, res, next, { action: 'reject' });
}

/** Admin-wide (not order-scoped) reviewer assignment - lives on kyc.routes.js. */
async function assignReviewer(req, res, next) {
  try {
    const result = await kycService.assignReviewer({
      documentId: req.params.documentId,
      reviewerId: req.body.reviewerId,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, { message: 'Reviewer assigned.', data: result });
  } catch (err) {
    next(err);
  }
}

/** Lists comments for an order's KYC. Staff see internal + client-visible; a client only ever sees client-visible (service-enforced). */
async function listComments(req, res, next) {
  try {
    const includeInternal = !isClientReq(req);
    const comments = await kycCommentsService.listComments({
      orderId: req.resource._id,
      documentId: req.query.documentId || null,
      includeInternal,
    });
    return sendSuccess(res, { message: 'KYC comments.', data: comments });
  } catch (err) {
    next(err);
  }
}

/** Adds a comment. The service itself forces CLIENT-authored comments to CLIENT_VISIBLE regardless of what's requested. */
async function addComment(req, res, next) {
  try {
    const comment = await kycCommentsService.addComment({
      orderId: req.resource._id,
      clientId: req.resource.client,
      documentId: req.body.documentId || null,
      message: req.body.message,
      visibility: req.body.visibility,
      actor: { _id: req.user._id, role: req.user.role, name: req.user.name, email: req.user.email },
    });
    await logAudit({
      actor: req.user._id,
      actorRole: req.user.role,
      action: AUDIT_ACTIONS.KYC_COMMENT_ADDED,
      resourceType: 'Order',
      resourceId: req.resource._id,
      metadata: { commentId: String(comment.id), visibility: comment.visibility, documentId: comment.document ? String(comment.document) : null },
      ...requestMeta(req),
    });
    return sendSuccess(res, { statusCode: 201, message: 'Comment added.', data: comment });
  } catch (err) {
    next(err);
  }
}

/** Bulk export (ZIP or CSV manifest) of an order's current KYC documents. */
async function exportOrderKyc(req, res, next) {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'zip';
    const { buffer, filename, mimeType } = await kycService.exportOrderKycDocuments({
      order: req.resource,
      format,
      actor: req.user,
      meta: requestMeta(req),
    });
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
}

/** Bulk export (ZIP or CSV manifest) of a client's current KYC documents across all their orders. */
async function exportClientKyc(req, res, next) {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'zip';
    const { buffer, filename, mimeType } = await kycService.exportClientKycDocuments({
      clientId: req.params.clientId,
      format,
      actor: req.user,
      meta: requestMeta(req),
    });
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSummary,
  listDocuments,
  upload,
  download,
  verify,
  reject,
  requestReupload,
  submit,
  startReview,
  approveOrderKyc,
  rejectOrderKyc,
  forceVerify,
  forceReject,
  bulkVerify,
  bulkReject,
  assignReviewer,
  listComments,
  addComment,
  exportOrderKyc,
  exportClientKyc,
};
