const { KycDocument } = require('../../models/portal');
const { KYC_DOCUMENT_STATUS, isValidDocumentStatusTransition } = require('../../constants/portal/kycStatus');
const { ORDER_STATUS } = require('../../constants/portal/orderStatus');
const AppError = require('../../utils/portal/AppError');
const { transitionOrderStatus } = require('./orderStateMachine.service');
const { logAudit } = require('./auditLog.service');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');

/**
 * The single place that (a) enforces the per-document review-status
 * transition graph and (b) decides when a document event should also move
 * the ORDER forward. Order-status changes always go through the existing
 * `orderStateMachine.service.js` (never set directly) - this module is a
 * caller of that service, not a second state machine.
 */

/** Current-version, not-yet-deleted documents for an order. */
async function getCurrentDocuments(orderId) {
  return KycDocument.find({ order: orderId, isCurrentVersion: true, lifecycleStatus: { $ne: 'DELETED' } });
}

/**
 * Is every MANDATORY required document for this order currently VERIFIED?
 * An order with no KYC requirement (empty requiredDocuments snapshot) is
 * trivially complete.
 */
async function isKycComplete(order) {
  const required = (order.serviceSnapshot?.requiredDocuments || []).filter((d) => d.mandatory !== false);
  if (required.length === 0) return true;

  const documents = await getCurrentDocuments(order._id);
  const verifiedTypes = new Set(documents.filter((d) => d.status === KYC_DOCUMENT_STATUS.VERIFIED).map((d) => d.documentType));
  return required.every((d) => verifiedTypes.has(d.documentType));
}

/** Are all mandatory required documents at least uploaded (any status)? */
async function isSubmissionComplete(order) {
  const required = (order.serviceSnapshot?.requiredDocuments || []).filter((d) => d.mandatory !== false);
  if (required.length === 0) return true;

  const documents = await getCurrentDocuments(order._id);
  const uploadedTypes = new Set(documents.map((d) => d.documentType));
  return required.every((d) => uploadedTypes.has(d.documentType));
}

/**
 * Does any current-version required document currently sit REJECTED (or,
 * Part 5 addition, NEED_REUPLOAD)? Both outcomes mean the client must
 * re-submit that document before the order can proceed, so both revert the
 * order the same way in reconcileOrderAfterDocumentDecision below - see
 * KYC_DOCUMENT_STATUS.NEED_REUPLOAD's doc-comment in constants/portal/
 * kycStatus.js for why this is a document-level-only distinction.
 */
async function hasRejectedRequiredDocument(order) {
  const requiredTypes = new Set((order.serviceSnapshot?.requiredDocuments || []).map((d) => d.documentType));
  if (requiredTypes.size === 0) return false;
  const documents = await getCurrentDocuments(order._id);
  return documents.some(
    (d) =>
      requiredTypes.has(d.documentType) &&
      (d.status === KYC_DOCUMENT_STATUS.REJECTED || d.status === KYC_DOCUMENT_STATUS.NEED_REUPLOAD)
  );
}

/**
 * Called after a successful upload/re-upload. If this was the last
 * mandatory document needed, the client may now submit for review - but
 * submission itself is a distinct, explicit client action
 * (`POST /:id/kyc/submit`), not triggered automatically here, so a client
 * uploading documents one at a time never accidentally fires a premature
 * review.
 */
async function assertCanUpload(order) {
  if (![ORDER_STATUS.KYC_PENDING, ORDER_STATUS.KYC_REJECTED].includes(order.status)) {
    throw AppError.badRequest(`This order is not currently accepting KYC document uploads (status: ${order.status}).`);
  }
}

/** Client action: move the order from KYC_PENDING/KYC_REJECTED to KYC_SUBMITTED once complete. */
async function submitForReview(order, actor, meta = {}) {
  if (![ORDER_STATUS.KYC_PENDING, ORDER_STATUS.KYC_REJECTED].includes(order.status)) {
    throw AppError.badRequest(`Cannot submit KYC from the current order status (${order.status}).`);
  }
  if (!(await isSubmissionComplete(order))) {
    throw AppError.badRequest('All required documents must be uploaded before submitting for review.');
  }

  const updated = await transitionOrderStatus({
    orderId: order._id,
    toStatus: ORDER_STATUS.KYC_SUBMITTED,
    changedBy: actor._id,
    reason: 'Client submitted KYC documents for review.',
  });

  await logAudit({
    actor: actor._id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.KYC_SUBMITTED,
    resourceType: 'Order',
    resourceId: order._id,
    ...meta,
  });

  return updated;
}

/** Internal action: move the order from KYC_SUBMITTED to KYC_VERIFICATION. */
async function startReview(order, actor, meta = {}) {
  const updated = await transitionOrderStatus({
    orderId: order._id,
    toStatus: ORDER_STATUS.KYC_VERIFICATION,
    changedBy: actor._id,
    reason: 'Internal review started.',
  });

  await logAudit({
    actor: actor._id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.KYC_REVIEW_STARTED,
    resourceType: 'Order',
    resourceId: order._id,
    ...meta,
  });

  return updated;
}

/**
 * Re-evaluates the order's KYC status after a document's review status
 * changes, moving it forward only when every required document is
 * VERIFIED, or back to KYC_REJECTED when any required document is
 * REJECTED. Does nothing if the order isn't currently in KYC_VERIFICATION
 * (e.g. an out-of-band re-review of an already-decided order).
 */
async function reconcileOrderAfterDocumentDecision(order, actor, meta = {}) {
  if (order.status !== ORDER_STATUS.KYC_VERIFICATION) return order;

  if (await isKycComplete(order)) {
    return transitionOrderStatus({
      orderId: order._id,
      toStatus: ORDER_STATUS.IN_PROGRESS,
      changedBy: actor._id,
      reason: 'All required KYC documents verified.',
    });
  }

  if (await hasRejectedRequiredDocument(order)) {
    const updated = await transitionOrderStatus({
      orderId: order._id,
      toStatus: ORDER_STATUS.KYC_REJECTED,
      changedBy: actor._id,
      reason: 'One or more required KYC documents were rejected.',
    });
    await logAudit({
      actor: actor._id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.KYC_REJECTED,
      resourceType: 'Order',
      resourceId: order._id,
      ...meta,
    });
    return updated;
  }

  return order; // still waiting on other documents
}

function assertValidDocumentTransition(from, to) {
  if (!isValidDocumentStatusTransition(from, to)) {
    throw AppError.invalidStateTransition(`Cannot move a document from ${from} to ${to}.`);
  }
}

module.exports = {
  getCurrentDocuments,
  isKycComplete,
  isSubmissionComplete,
  hasRejectedRequiredDocument,
  assertCanUpload,
  submitForReview,
  startReview,
  reconcileOrderAfterDocumentDecision,
  assertValidDocumentTransition,
};
