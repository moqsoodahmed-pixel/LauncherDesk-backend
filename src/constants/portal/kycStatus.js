/**
 * Per-document KYC status and the document retention/deletion lifecycle.
 * Order-level KYC progress is NOT a separate state machine - it rides the
 * existing Order status (`KYC_PENDING -> KYC_SUBMITTED -> KYC_VERIFICATION
 * -> IN_PROGRESS`, with `KYC_REJECTED` as a detour), enforced exclusively
 * through `services/orderStateMachine.service.js` (see
 * `services/kycState.service.js` for how document events trigger it).
 */
const KYC_DOCUMENT_STATUS = Object.freeze({
  UPLOADED: 'UPLOADED', // just received, awaiting review
  UNDER_REVIEW: 'UNDER_REVIEW', // an internal user has started reviewing it
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  // Part 5 enterprise KYC addition. A real, distinct backing status (not a
  // REJECTED-with-a-flag reuse) for a reviewer who wants a cleaner/clearer
  // copy of the SAME document without declaring the harsher, more final
  // REJECTED outcome. Architectural call: at the per-document level this is
  // its own terminal review state (see transitions below); at the ORDER
  // level, reconcileOrderAfterDocumentDecision (kycState.service.js) treats
  // it exactly like REJECTED (the order reverts to KYC_REJECTED so the
  // client can re-upload) because the order status machine itself is not
  // being extended with a parallel state - only the per-document record
  // needs the softer label. Re-upload after NEED_REUPLOAD follows the exact
  // same versioning path as a REJECTED re-upload (kyc.service.js's
  // uploadDocument: a new KycDocument row at version+1, starting again at
  // UPLOADED).
  NEED_REUPLOAD: 'NEED_REUPLOAD',
});

const ALL_KYC_DOCUMENT_STATUSES = Object.values(KYC_DOCUMENT_STATUS);

/**
 * Allowed per-document status transitions. A REJECTED (or NEED_REUPLOAD)
 * document is never "fixed" in place - the client uploads a new version (a
 * new KycDocument row starting again at UPLOADED); see kyc.service.js's
 * versioning.
 */
const KYC_DOCUMENT_STATUS_TRANSITIONS = Object.freeze({
  [KYC_DOCUMENT_STATUS.UPLOADED]: [KYC_DOCUMENT_STATUS.UNDER_REVIEW],
  [KYC_DOCUMENT_STATUS.UNDER_REVIEW]: [
    KYC_DOCUMENT_STATUS.VERIFIED,
    KYC_DOCUMENT_STATUS.REJECTED,
    KYC_DOCUMENT_STATUS.NEED_REUPLOAD,
  ],
  [KYC_DOCUMENT_STATUS.VERIFIED]: [],
  [KYC_DOCUMENT_STATUS.REJECTED]: [],
  [KYC_DOCUMENT_STATUS.NEED_REUPLOAD]: [],
});

function isValidDocumentStatusTransition(from, to) {
  if (from === to) return false;
  return (KYC_DOCUMENT_STATUS_TRANSITIONS[from] || []).includes(to);
}

/**
 * Document retention/deletion lifecycle - distinct from review status. A
 * document can be VERIFIED (review outcome) and still be ACTIVE (lifecycle)
 * until the order reaches KYC_DELETION_PENDING and the configured
 * retention window elapses (see services/kycRetention.service.js).
 */
const KYC_DOCUMENT_LIFECYCLE = Object.freeze({
  ACTIVE: 'ACTIVE',
  DELETION_PENDING: 'DELETION_PENDING',
  DELETED: 'DELETED',
});

const ALL_KYC_DOCUMENT_LIFECYCLE_STATES = Object.values(KYC_DOCUMENT_LIFECYCLE);

/**
 * "Expired" (client-facing, brief's Part 5 status list) is deliberately NOT
 * built on `retentionExpiresAt`/`KYC_DOCUMENT_LIFECYCLE` above - those model
 * WHEN WE DELETE THE FILE for privacy/compliance after an order closes,
 * which is unrelated to whether the document's own real-world validity
 * (e.g. a passport or driving license) has lapsed. Checked first, per the
 * brief's instruction, and confirmed they are different concepts that
 * would be wrong to conflate.
 *
 * Instead: KycDocument gained one new optional field, `validUntil` (a
 * reviewer- or OCR-settable real-world expiry date for the document
 * itself), and "Expired"/"Approved"/"Need Re-upload" etc. are computed as
 * DISPLAY-ONLY labels in the new services/portal/kycDisplayStatus.service.js
 * - never persisted as a enum value and never touching the VERIFIED enum
 * value itself (which stays exactly as-is everywhere it's already
 * referenced: documents, notifications, audit logs).
 */
const KYC_CLIENT_DISPLAY_STATUS = Object.freeze({
  PENDING: 'Pending', // no document uploaded yet for a relevant/required type
  UPLOADED: 'Uploaded',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved', // display label for KYC_DOCUMENT_STATUS.VERIFIED
  REJECTED: 'Rejected',
  NEED_REUPLOAD: 'Need Re-upload',
  EXPIRED: 'Expired', // VERIFIED + validUntil in the past
});

module.exports = {
  KYC_DOCUMENT_STATUS,
  ALL_KYC_DOCUMENT_STATUSES,
  KYC_DOCUMENT_STATUS_TRANSITIONS,
  isValidDocumentStatusTransition,
  KYC_DOCUMENT_LIFECYCLE,
  ALL_KYC_DOCUMENT_LIFECYCLE_STATES,
  KYC_CLIENT_DISPLAY_STATUS,
};
