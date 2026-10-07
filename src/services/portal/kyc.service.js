const mongoose = require('mongoose');
const { KycDocument, KycVerification } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const env = require('../../config/portal');
const { KYC_DOCUMENT_STATUS } = require('../../constants/portal/kycStatus');
const { ORDER_STATUS } = require('../../constants/portal/orderStatus');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { validateFileContent } = require('./fileSignature.service');
const documentStorage = require('./documentStorage.service');
const kycState = require('./kycState.service');
const { logAudit } = require('./auditLog.service');
const { generateKycCode } = require('./idGenerator.service');
const communicationService = require('./communication.service');
const notificationEventsService = require('./notificationEvents.service');

const MAX_FILE_SIZE_BYTES = () => env.MAX_KYC_FILE_SIZE_MB * 1024 * 1024;

function auditCtx(actor) {
  return { actor: actor._id, actorRole: actor.role };
}

/** Full shape for internal (Super Admin / permitted Admin) consumers. Never includes storageKey. */
function serializeDocument(doc) {
  return {
    id: doc._id,
    kycCode: doc.kycCode ?? null,
    documentType: doc.documentType,
    version: doc.version,
    isCurrentVersion: doc.isCurrentVersion,
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    checksum: doc.checksum,
    status: doc.status,
    reviewedBy: doc.reviewedBy ?? null,
    reviewedAt: doc.reviewedAt ?? null,
    rejectionReason: doc.rejectionReason ?? null,
    lifecycleStatus: doc.lifecycleStatus,
    uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Client-safe shape: no internal reviewer id, no checksum (internal
 * integrity/troubleshooting detail, not client business), no storage
 * internals of any kind.
 */
function serializeDocumentForClient(doc) {
  return {
    id: doc._id,
    documentType: doc.documentType,
    version: doc.version,
    status: doc.status,
    originalFileName: doc.originalFileName,
    sizeBytes: doc.sizeBytes,
    uploadedAt: doc.createdAt,
    reviewedAt: doc.reviewedAt ?? null,
    rejectionReason: doc.rejectionReason ?? null,
  };
}

async function listDocuments(orderId, { includeAllVersions = false } = {}) {
  const filter = { order: orderId, lifecycleStatus: { $ne: 'DELETED' } };
  if (!includeAllVersions) filter.isCurrentVersion = true;
  return KycDocument.find(filter).sort({ documentType: 1, version: -1 });
}

/**
 * The client-safe order-level KYC summary (brief's example response
 * shape): whether KYC applies at all, the overall order-level status, and
 * per-required-document status/rejection reason. Built from the order's
 * requiredDocuments SNAPSHOT (not the live Service) and the order's
 * current-version documents - never a second persisted aggregate.
 */
async function getOrderKycSummary(order) {
  const required = order.serviceSnapshot?.requiredDocuments || [];
  if (!order.serviceSnapshot?.requiresKyc || required.length === 0) {
    return { required: false, status: null, documents: [] };
  }

  const documents = await listDocuments(order._id);
  const byType = new Map(documents.map((d) => [d.documentType, d]));

  return {
    required: true,
    status: order.status,
    documents: required.map((r) => {
      const doc = byType.get(r.documentType);
      return {
        type: r.documentType,
        label: r.label,
        mandatory: r.mandatory !== false,
        status: doc ? doc.status : 'NOT_UPLOADED',
        rejectionReason: doc?.status === KYC_DOCUMENT_STATUS.REJECTED ? doc.rejectionReason : null,
      };
    }),
  };
}

function assertDocumentTypeApplies(order, documentType) {
  const required = order.serviceSnapshot?.requiredDocuments || [];
  if (!required.some((d) => d.documentType === documentType)) {
    throw AppError.badRequest('This document is not required for this order.');
  }
}

/**
 * Uploads a new document (or a new VERSION of a rejected one). Never
 * trusts a client-supplied storageKey/status/client/order ownership -
 * `order` here is always the already scope-checked document loaded by the
 * route's IDOR-safe middleware, and `documentType` is validated against
 * the order's own requiredDocuments snapshot, not an arbitrary string.
 */
async function uploadDocument({ order, documentType, file, actor, meta = {} }) {
  await kycState.assertCanUpload(order);
  assertDocumentTypeApplies(order, documentType);

  if (!file || !file.buffer || file.buffer.length === 0) {
    throw AppError.badRequest('A file is required.');
  }
  if (file.buffer.length > MAX_FILE_SIZE_BYTES()) {
    throw AppError.badRequest(`File exceeds the maximum allowed size of ${env.MAX_KYC_FILE_SIZE_MB}MB.`);
  }

  const contentCheck = validateFileContent(file.buffer, file.mimetype);
  if (!contentCheck.valid) {
    throw AppError.badRequest(contentCheck.reason);
  }

  const existing = await KycDocument.findOne({ order: order._id, documentType, isCurrentVersion: true });
  if (existing && existing.status !== KYC_DOCUMENT_STATUS.REJECTED) {
    throw AppError.conflict(
      `A ${documentType} document is already ${existing.status.toLowerCase()} for this order. Wait for review, or it must be rejected before re-uploading.`
    );
  }

  let stored;
  try {
    stored = await documentStorage.uploadPrivateDocument({
      buffer: file.buffer,
      originalFileName: file.originalname,
      keyPrefix: String(order._id),
    });
  } catch (err) {
    throw AppError.badRequest('Could not store the uploaded file. Please try again.');
  }

  let created;
  try {
    if (existing) {
      existing.isCurrentVersion = false;
      await existing.save();
    }

    const kycCode = await generateKycCode();
    created = await KycDocument.create({
      kycCode,
      client: order.client,
      order: order._id,
      documentType,
      version: existing ? existing.version + 1 : 1,
      isCurrentVersion: true,
      originalFileName: safeDisplayFileName(file.originalname),
      mimeType: contentCheck.detectedMimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      storageProvider: stored.storageProvider,
      storageKey: stored.storageKey,
      status: KYC_DOCUMENT_STATUS.UPLOADED,
      uploadedBy: actor._id,
    });
  } catch (err) {
    // DB write failed after the file was already stored - never leave an
    // orphaned, unreferenced private file behind.
    await documentStorage.deletePrivateDocument(stored.storageKey).catch(() => {});
    if (existing) {
      existing.isCurrentVersion = true;
      await existing.save().catch(() => {});
    }
    throw err;
  }

  await logAudit({
    ...auditCtx(actor),
    action: existing ? AUDIT_ACTIONS.KYC_DOCUMENT_REPLACED : AUDIT_ACTIONS.KYC_UPLOADED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { documentType, version: created.version, documentId: String(created._id) },
    ...meta,
  });

  return created;
}

// Never let a filename act as a path component or carry control
// characters into logs/headers - display only, never used as a storage path.
function safeDisplayFileName(name) {
  const base = String(name || 'document').replace(/[\\/]/g, '_');
  return base.slice(-200);
}

async function loadDocumentOrThrow(orderId, documentId) {
  if (!mongoose.isValidObjectId(documentId)) {
    throw AppError.notFound('Document not found.');
  }
  // Scoped to the order in the same query - a document id from a DIFFERENT
  // order 404s exactly like a nonexistent id (no existence oracle).
  const doc = await KycDocument.findOne({ _id: documentId, order: orderId, lifecycleStatus: { $ne: 'DELETED' } });
  if (!doc) {
    throw AppError.notFound('Document not found.');
  }
  return doc;
}

async function verifyDocument({ order, documentId, actor, meta = {} }) {
  if (order.status !== ORDER_STATUS.KYC_VERIFICATION) {
    throw AppError.badRequest('This order is not currently under KYC review.');
  }
  const doc = await loadDocumentOrThrow(order._id, documentId);
  await applyReviewStart(doc, actor, meta);

  kycState.assertValidDocumentTransition(doc.status, KYC_DOCUMENT_STATUS.VERIFIED);
  doc.status = KYC_DOCUMENT_STATUS.VERIFIED;
  doc.reviewedBy = actor._id;
  doc.reviewedAt = new Date();
  doc.rejectionReason = null;
  await doc.save();

  await KycVerification.create({
    document: doc._id,
    order: order._id,
    client: order.client,
    action: 'VERIFIED',
    resultingStatus: doc.status,
    performedBy: actor._id,
  });
  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.KYC_DOCUMENT_VERIFIED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { documentId: String(doc._id), documentType: doc.documentType },
    ...meta,
  });

  const updatedOrder = await kycState.reconcileOrderAfterDocumentDecision(order, actor, meta);
  return { document: doc, order: updatedOrder };
}

async function rejectDocument({ order, documentId, reason, actor, meta = {} }) {
  if (order.status !== ORDER_STATUS.KYC_VERIFICATION) {
    throw AppError.badRequest('This order is not currently under KYC review.');
  }
  const doc = await loadDocumentOrThrow(order._id, documentId);
  await applyReviewStart(doc, actor, meta);

  kycState.assertValidDocumentTransition(doc.status, KYC_DOCUMENT_STATUS.REJECTED);
  doc.status = KYC_DOCUMENT_STATUS.REJECTED;
  doc.reviewedBy = actor._id;
  doc.reviewedAt = new Date();
  doc.rejectionReason = reason;
  await doc.save();

  await KycVerification.create({
    document: doc._id,
    order: order._id,
    client: order.client,
    action: 'REJECTED',
    resultingStatus: doc.status,
    reason,
    performedBy: actor._id,
  });
  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.KYC_DOCUMENT_REJECTED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { documentId: String(doc._id), documentType: doc.documentType, reason },
    ...meta,
  });
  await communicationService.sendKycDocumentRejected(order, doc).catch(() => {});
  await notificationEventsService.notifyKycDocumentRejected(order, doc).catch(() => {});

  const updatedOrder = await kycState.reconcileOrderAfterDocumentDecision(order, actor, meta);
  return { document: doc, order: updatedOrder };
}

async function applyReviewStart(doc, actor, meta) {
  if (doc.status !== KYC_DOCUMENT_STATUS.UPLOADED) return;
  kycState.assertValidDocumentTransition(doc.status, KYC_DOCUMENT_STATUS.UNDER_REVIEW);
  doc.status = KYC_DOCUMENT_STATUS.UNDER_REVIEW;
  await doc.save();
  await KycVerification.create({
    document: doc._id,
    order: doc.order,
    client: doc.client,
    action: 'REVIEW_STARTED',
    resultingStatus: doc.status,
    performedBy: actor._id,
  });
}

/**
 * Loads the file for a download. `requireClientId`, when supplied, adds an
 * extra belt-and-braces ownership check beyond the order scope the route
 * already enforced (the client route passes its own clientProfile id).
 */
async function getDocumentForDownload({ order, documentId, actor, requireClientId = null, meta = {} }) {
  const doc = await KycDocument.findOne({ _id: documentId, order: order._id, lifecycleStatus: { $ne: 'DELETED' } }).select('+storageKey');
  if (!doc) {
    throw AppError.notFound('Document not found.');
  }
  if (requireClientId && String(doc.client) !== String(requireClientId)) {
    throw AppError.notFound('Document not found.');
  }

  const buffer = await documentStorage.getPrivateDocument(doc.storageKey);

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.KYC_DOWNLOADED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { documentId: String(doc._id), documentType: doc.documentType },
    ...meta,
  });

  return { buffer, mimeType: doc.mimeType, originalFileName: safeDisplayFileName(doc.originalFileName) };
}

module.exports = {
  serializeDocument,
  serializeDocumentForClient,
  listDocuments,
  getOrderKycSummary,
  uploadDocument,
  verifyDocument,
  rejectDocument,
  getDocumentForDownload,
  loadDocumentOrThrow,
};
