const mongoose = require('mongoose');
const { KycDocument, KycVerification, User } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const env = require('../../config/portal');
const { KYC_DOCUMENT_STATUS } = require('../../constants/portal/kycStatus');
const { ORDER_STATUS } = require('../../constants/portal/orderStatus');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { ROLES } = require('../../constants/portal/roles');
const { validateFileContent } = require('./fileSignature.service');
const { getAntivirusProvider } = require('../../adapters/antivirus');
const documentStorage = require('./documentStorage.service');
const kycState = require('./kycState.service');
const { logAudit } = require('./auditLog.service');
const { generateKycCode } = require('./idGenerator.service');
const communicationService = require('./communication.service');
const notificationEventsService = require('./notificationEvents.service');
const { buildZip, toCsv } = require('../../utils/portal/exportFormats');

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

  // Part 5 addition: a real integration point for virus/malware scanning,
  // right alongside the existing file-signature check above. The default
  // DisabledAntivirusProvider always returns { clean: true }, so current
  // upload behavior is completely unchanged until a real provider is
  // configured (see adapters/antivirus/).
  const scanResult = await getAntivirusProvider().scan(file.buffer);
  if (!scanResult.clean) {
    throw AppError.badRequest('This file failed a security scan and could not be uploaded.');
  }

  const existing = await KycDocument.findOne({ order: order._id, documentType, isCurrentVersion: true });
  // Part 5 addition: NEED_REUPLOAD (see KYC_DOCUMENT_STATUS doc-comment) is,
  // like REJECTED, a state the client re-uploads out of.
  const REUPLOADABLE_STATUSES = [KYC_DOCUMENT_STATUS.REJECTED, KYC_DOCUMENT_STATUS.NEED_REUPLOAD];
  if (existing && !REUPLOADABLE_STATUSES.includes(existing.status)) {
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
      mimeType: contentCheck.detectedMimeType,
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

/**
 * Part 5 addition: the softer sibling of rejectDocument - moves a document
 * to NEED_REUPLOAD instead of REJECTED (see KYC_DOCUMENT_STATUS's
 * doc-comment for the architectural reasoning). Deliberately mirrors
 * rejectDocument's structure/shape so the two are drop-in alternatives for
 * a reviewer UI, but does NOT dispatch the existing KYC_DOCUMENT_REJECTED
 * communication/notification (that wiring is reserved for genuine
 * rejections) - a dedicated "please re-upload" communication/notification
 * is left for the next wave (admin workflows) to add if desired, since
 * extending communication.service.js/notificationEvents.service.js further
 * is outside this pass's scope.
 */
async function requestReupload({ order, documentId, reason, actor, meta = {} }) {
  if (order.status !== ORDER_STATUS.KYC_VERIFICATION) {
    throw AppError.badRequest('This order is not currently under KYC review.');
  }
  const doc = await loadDocumentOrThrow(order._id, documentId);
  await applyReviewStart(doc, actor, meta);

  kycState.assertValidDocumentTransition(doc.status, KYC_DOCUMENT_STATUS.NEED_REUPLOAD);
  doc.status = KYC_DOCUMENT_STATUS.NEED_REUPLOAD;
  doc.reviewedBy = actor._id;
  doc.reviewedAt = new Date();
  doc.rejectionReason = reason;
  await doc.save();

  await KycVerification.create({
    document: doc._id,
    order: order._id,
    client: order.client,
    action: 'NEED_REUPLOAD',
    resultingStatus: doc.status,
    reason,
    performedBy: actor._id,
  });
  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.KYC_DOCUMENT_REUPLOAD_REQUESTED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { documentId: String(doc._id), documentType: doc.documentType, reason },
    ...meta,
  });
  // Wave 2: Wave 1 deliberately left this uncommunicated (see this
  // function's doc-comment) - now wired to its own dedicated event,
  // mirroring sendKycDocumentRejected/notifyKycDocumentRejected's pattern
  // exactly rather than reusing the harsher REJECTED ones.
  await communicationService.sendKycDocumentNeedReupload(order, doc).catch(() => {});
  await notificationEventsService.notifyKycDocumentNeedsReupload(order, doc).catch(() => {});

  const updatedOrder = await kycState.reconcileOrderAfterDocumentDecision(order, actor, meta);
  return { document: doc, order: updatedOrder };
}

/**
 * Wave 2 addition: Super Admin "force approve" - identical to verifyDocument
 * except it deliberately SKIPS the `order.status === KYC_VERIFICATION` guard
 * (e.g. an order that already moved on, or reverted to KYC_REJECTED, but a
 * Super Admin needs to correct one document's outcome directly). The
 * document-level transition graph (kycState.assertValidDocumentTransition)
 * is NOT bypassed - only the order-status guard is. Route-level
 * `requireRole(ROLES.SUPER_ADMIN)` is what actually restricts who can reach
 * this; the service itself does not re-check role.
 */
async function forceApproveDocument({ order, documentId, actor, meta = {} }) {
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
    action: AUDIT_ACTIONS.KYC_FORCE_APPROVED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { documentId: String(doc._id), documentType: doc.documentType, orderStatusAtForce: order.status },
    ...meta,
  });

  // Only actually moves the order forward if it happens to still be in
  // KYC_VERIFICATION (reconcileOrderAfterDocumentDecision no-ops otherwise,
  // by design - a force-approve on an order in some other state corrects
  // the DOCUMENT's record without reaching into an unrelated order status).
  const updatedOrder = await kycState.reconcileOrderAfterDocumentDecision(order, actor, meta);
  return { document: doc, order: updatedOrder };
}

/** Wave 2 addition: the force-reject sibling of forceApproveDocument - see its doc-comment. */
async function forceRejectDocument({ order, documentId, reason, actor, meta = {} }) {
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
    action: AUDIT_ACTIONS.KYC_FORCE_REJECTED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { documentId: String(doc._id), documentType: doc.documentType, reason, orderStatusAtForce: order.status },
    ...meta,
  });
  // Reuses the EXISTING per-document rejection communication/notification -
  // a forced rejection is still, from the client's perspective, a document
  // rejection, no separate "forced" wording needed on their side.
  await communicationService.sendKycDocumentRejected(order, doc).catch(() => {});
  await notificationEventsService.notifyKycDocumentRejected(order, doc).catch(() => {});

  const updatedOrder = await kycState.reconcileOrderAfterDocumentDecision(order, actor, meta);
  return { document: doc, order: updatedOrder };
}

/**
 * Wave 2 addition: assigns an internal reviewer to one document (purely
 * organizational metadata - does not change who may call verify/reject,
 * which stays gated by the existing VERIFY_KYC/REJECT_KYC permissions).
 * Global (not order-scoped) since it is called from the admin-wide KYC
 * surface (routes/portal/kyc.routes.js), mirroring that router's existing
 * GET /stats and GET / which are likewise not order-nested.
 */
async function assignReviewer({ documentId, reviewerId, actor, meta = {} }) {
  if (!mongoose.isValidObjectId(documentId) || !mongoose.isValidObjectId(reviewerId)) {
    throw AppError.badRequest('Invalid document or reviewer id.');
  }
  const doc = await KycDocument.findOne({ _id: documentId, lifecycleStatus: { $ne: 'DELETED' } });
  if (!doc) throw AppError.notFound('Document not found.');

  const reviewer = await User.findOne({ _id: reviewerId, role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] }, status: 'ACTIVE' });
  if (!reviewer) {
    throw AppError.badRequest('reviewerId must be an active Admin or Super Admin.');
  }

  doc.assignedReviewer = reviewer._id;
  await doc.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.KYC_REVIEWER_ASSIGNED,
    resourceType: 'Order',
    resourceId: doc.order,
    metadata: { documentId: String(doc._id), documentType: doc.documentType, reviewerId: String(reviewer._id) },
    ...meta,
  });
  await notificationEventsService.notifyKycReviewerAssigned(doc, reviewer, actor._id).catch(() => {});

  return { id: doc._id, documentType: doc.documentType, assignedReviewer: { id: reviewer._id, name: reviewer.name, email: reviewer.email } };
}

const EXPORT_CSV_HEADERS = ['documentType', 'status', 'uploadedAt', 'reviewedAt', 'reviewer'];

function toManifestRow(doc) {
  return {
    documentType: doc.documentType,
    status: doc.status,
    uploadedAt: doc.createdAt ? doc.createdAt.toISOString() : '',
    reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : '',
    reviewer: doc.reviewedBy?.name || '',
  };
}

/**
 * Wave 2 addition: bulk export of an order's current-version KYC documents
 * as either a CSV manifest or a ZIP (files + a manifest.csv inside) - see
 * utils/portal/exportFormats.js for why this hand-rolls the ZIP rather than
 * adding a new dependency. Reuses documentStorage.getPrivateDocument (the
 * one sanctioned way to read a stored file) per document, exactly like the
 * existing getDocumentForDownload does for a single file.
 */
async function exportOrderKycDocuments({ order, format = 'zip', actor, meta = {} }) {
  const documents = await KycDocument.find({ order: order._id, isCurrentVersion: true, lifecycleStatus: { $ne: 'DELETED' } })
    .select('+storageKey')
    .populate('reviewedBy', 'name')
    .sort({ documentType: 1 });

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.KYC_BULK_EXPORTED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { format, documentCount: documents.length },
    ...meta,
  });

  const baseName = order.orderCode || String(order._id);

  if (format === 'csv') {
    const csv = toCsv(documents.map(toManifestRow), EXPORT_CSV_HEADERS);
    return { buffer: Buffer.from(csv, 'utf8'), filename: `kyc-manifest-${baseName}.csv`, mimeType: 'text/csv' };
  }

  const entries = [];
  const manifestRows = [];
  for (const doc of documents) {
    let fileBuffer;
    try {
      fileBuffer = await documentStorage.getPrivateDocument(doc.storageKey);
    } catch (err) {
      continue; // a missing/unreadable file never aborts the whole export
    }
    entries.push({ name: `${doc.documentType}_v${doc.version}_${safeDisplayFileName(doc.originalFileName)}`, buffer: fileBuffer });
    manifestRows.push(toManifestRow(doc));
  }
  entries.push({ name: 'manifest.csv', buffer: Buffer.from(toCsv(manifestRows, EXPORT_CSV_HEADERS), 'utf8') });

  return { buffer: buildZip(entries), filename: `kyc-documents-${baseName}.zip`, mimeType: 'application/zip' };
}

/**
 * Wave 2 addition: the client-wide (not single-order) variant, used from
 * the admin-wide KYC surface (kyc.routes.js) - "export everything we hold
 * for this client across all their orders".
 */
async function exportClientKycDocuments({ clientId, format = 'zip', actor, meta = {} }) {
  if (!mongoose.isValidObjectId(clientId)) {
    throw AppError.badRequest('Invalid client id.');
  }
  const documents = await KycDocument.find({ client: clientId, isCurrentVersion: true, lifecycleStatus: { $ne: 'DELETED' } })
    .select('+storageKey')
    .populate('reviewedBy', 'name')
    .populate('order', 'orderCode')
    .sort({ documentType: 1 });

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.KYC_BULK_EXPORTED,
    resourceType: 'Client',
    resourceId: clientId,
    metadata: { format, documentCount: documents.length },
    ...meta,
  });

  const rowOf = (doc) => ({ ...toManifestRow(doc), orderCode: doc.order?.orderCode || '' });
  const headers = [...EXPORT_CSV_HEADERS, 'orderCode'];

  if (format === 'csv') {
    const csv = toCsv(documents.map(rowOf), headers);
    return { buffer: Buffer.from(csv, 'utf8'), filename: `kyc-manifest-client-${clientId}.csv`, mimeType: 'text/csv' };
  }

  const entries = [];
  const manifestRows = [];
  for (const doc of documents) {
    let fileBuffer;
    try {
      fileBuffer = await documentStorage.getPrivateDocument(doc.storageKey);
    } catch (err) {
      continue;
    }
    entries.push({ name: `${doc.order?.orderCode || doc.order}_${doc.documentType}_v${doc.version}_${safeDisplayFileName(doc.originalFileName)}`, buffer: fileBuffer });
    manifestRows.push(rowOf(doc));
  }
  entries.push({ name: 'manifest.csv', buffer: Buffer.from(toCsv(manifestRows, headers), 'utf8') });

  return { buffer: buildZip(entries), filename: `kyc-documents-client-${clientId}.zip`, mimeType: 'application/zip' };
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
  requestReupload,
  getDocumentForDownload,
  loadDocumentOrThrow,
  // Wave 2 additions
  forceApproveDocument,
  forceRejectDocument,
  assignReviewer,
  exportOrderKycDocuments,
  exportClientKycDocuments,
};
