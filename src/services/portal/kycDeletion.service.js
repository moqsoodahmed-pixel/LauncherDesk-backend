const { KycDocument } = require('../../models/portal');
const { KYC_DOCUMENT_LIFECYCLE } = require('../../constants/portal/kycStatus');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const documentStorage = require('./documentStorage.service');
const { isOrderEligibleForDeletion } = require('./kycRetention.service');
const { logAudit } = require('./auditLog.service');
const logger = require('../../utils/portal/logger');

/**
 * Deletes exactly one document's private file and flips its lifecycle to
 * DELETED. Idempotent: if the file is already gone (or the document is
 * already marked DELETED), this is a safe no-op rather than an error -
 * running the cleanup job twice must never fail or corrupt metadata.
 * Never marks a document DELETED while its underlying file still exists;
 * if the storage delete throws, the document is left exactly as it was
 * (ACTIVE) and the failure is reported, never silently swallowed as a
 * false success.
 */
async function deleteDocumentFile(doc, { deletedBy, reason, meta = {} } = {}) {
  if (doc.lifecycleStatus === KYC_DOCUMENT_LIFECYCLE.DELETED) {
    return { document: doc, alreadyDeleted: true };
  }

  try {
    await documentStorage.deletePrivateDocument(doc.storageKey);
  } catch (err) {
    await logAudit({
      actor: null,
      actorRole: 'SYSTEM',
      action: AUDIT_ACTIONS.KYC_DELETION_FAILED,
      resourceType: 'Order',
      resourceId: doc.order,
      metadata: { documentId: String(doc._id), documentType: doc.documentType, error: err.message },
      ...meta,
    });
    logger.error(`[kycDeletion] Failed to delete storage for document ${doc._id}:`, err.message);
    throw err;
  }

  doc.lifecycleStatus = KYC_DOCUMENT_LIFECYCLE.DELETED;
  doc.deletedAt = new Date();
  doc.deletedBy = deletedBy;
  doc.deletionReason = reason || 'Retention period elapsed.';
  await doc.save();

  await logAudit({
    actor: null,
    actorRole: 'SYSTEM',
    action: AUDIT_ACTIONS.KYC_DOCUMENT_DELETED,
    resourceType: 'Order',
    resourceId: doc.order,
    metadata: { documentId: String(doc._id), documentType: doc.documentType, deletedBy, reason: doc.deletionReason },
    ...meta,
  });

  return { document: doc, alreadyDeleted: false };
}

/**
 * Finds every ACTIVE document for an eligible order and deletes each.
 * Tolerant of partial prior runs (idempotent) - a document already
 * DELETED is skipped, and one failure doesn't abort the others.
 */
async function deleteEligibleOrderDocuments(order, { deletedBy = 'SYSTEM_RETENTION_JOB', reason, meta = {} } = {}) {
  if (!isOrderEligibleForDeletion(order)) {
    return { eligible: false, deleted: 0, failed: 0, documents: [] };
  }

  const documents = await KycDocument.find({ order: order._id, lifecycleStatus: { $ne: KYC_DOCUMENT_LIFECYCLE.DELETED } }).select(
    '+storageKey'
  );

  let deleted = 0;
  let failed = 0;
  const results = [];
  for (const doc of documents) {
    try {
      const { alreadyDeleted } = await deleteDocumentFile(doc, { deletedBy, reason, meta });
      if (!alreadyDeleted) deleted += 1;
      results.push({ documentId: doc._id, status: 'deleted' });
    } catch (err) {
      failed += 1;
      results.push({ documentId: doc._id, status: 'failed', error: err.message });
    }
  }

  return { eligible: true, deleted, failed, documents: results };
}

/**
 * An order may proceed to CLOSED only once every one of its (non-deleted
 * at upload time) documents has actually been deleted - never faked.
 * Orders with no KYC requirement at all are trivially eligible.
 */
async function isOrderEligibleForClosure(order) {
  if (!order.serviceSnapshot?.requiresKyc) return true;
  const remaining = await KycDocument.countDocuments({
    order: order._id,
    lifecycleStatus: { $ne: KYC_DOCUMENT_LIFECYCLE.DELETED },
  });
  return remaining === 0;
}

module.exports = { deleteDocumentFile, deleteEligibleOrderDocuments, isOrderEligibleForClosure };
