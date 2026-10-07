const kycService = require('../../services/portal/kyc.service');
const kycState = require('../../services/portal/kycState.service');
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

module.exports = { getSummary, listDocuments, upload, download, verify, reject, submit, startReview };
