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
});

const ALL_KYC_DOCUMENT_STATUSES = Object.values(KYC_DOCUMENT_STATUS);

/**
 * Allowed per-document status transitions. A REJECTED document is never
 * "fixed" in place - the client uploads a new version (a new KycDocument
 * row starting again at UPLOADED); see kyc.service.js's versioning.
 */
const KYC_DOCUMENT_STATUS_TRANSITIONS = Object.freeze({
  [KYC_DOCUMENT_STATUS.UPLOADED]: [KYC_DOCUMENT_STATUS.UNDER_REVIEW],
  [KYC_DOCUMENT_STATUS.UNDER_REVIEW]: [KYC_DOCUMENT_STATUS.VERIFIED, KYC_DOCUMENT_STATUS.REJECTED],
  [KYC_DOCUMENT_STATUS.VERIFIED]: [],
  [KYC_DOCUMENT_STATUS.REJECTED]: [],
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

module.exports = {
  KYC_DOCUMENT_STATUS,
  ALL_KYC_DOCUMENT_STATUSES,
  KYC_DOCUMENT_STATUS_TRANSITIONS,
  isValidDocumentStatusTransition,
  KYC_DOCUMENT_LIFECYCLE,
  ALL_KYC_DOCUMENT_LIFECYCLE_STATES,
};
