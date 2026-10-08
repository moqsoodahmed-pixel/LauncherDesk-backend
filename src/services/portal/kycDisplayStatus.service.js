const { KYC_DOCUMENT_STATUS, KYC_CLIENT_DISPLAY_STATUS } = require('../../constants/portal/kycStatus');

/**
 * NEW, additive, client-facing DISPLAY layer only (Part 5 enterprise KYC).
 * Never replaces or mutates the real `KycDocument.status` enum, and is
 * never consumed by kyc.service.js's existing `serializeDocument` /
 * `serializeDocumentForClient` (those stay byte-for-byte as they were).
 * Callers (the next-wave client KYC dashboard) call this IN ADDITION TO
 * the existing serializers to get a `displayStatus` label.
 *
 * Mapping:
 *   no document for a required type -> "Pending"
 *   UPLOADED                        -> "Uploaded"
 *   UNDER_REVIEW                    -> "Under Review"
 *   VERIFIED (validUntil in future or unset) -> "Approved"
 *   VERIFIED (validUntil in the past)        -> "Expired"
 *   REJECTED                        -> "Rejected"
 *   NEED_REUPLOAD                   -> "Need Re-upload"
 */
function toClientDisplayStatus(doc) {
  if (!doc) return KYC_CLIENT_DISPLAY_STATUS.PENDING;

  if (doc.status === KYC_DOCUMENT_STATUS.VERIFIED) {
    if (doc.validUntil && new Date(doc.validUntil).getTime() < Date.now()) {
      return KYC_CLIENT_DISPLAY_STATUS.EXPIRED;
    }
    return KYC_CLIENT_DISPLAY_STATUS.APPROVED;
  }

  switch (doc.status) {
    case KYC_DOCUMENT_STATUS.UPLOADED:
      return KYC_CLIENT_DISPLAY_STATUS.UPLOADED;
    case KYC_DOCUMENT_STATUS.UNDER_REVIEW:
      return KYC_CLIENT_DISPLAY_STATUS.UNDER_REVIEW;
    case KYC_DOCUMENT_STATUS.REJECTED:
      return KYC_CLIENT_DISPLAY_STATUS.REJECTED;
    case KYC_DOCUMENT_STATUS.NEED_REUPLOAD:
      return KYC_CLIENT_DISPLAY_STATUS.NEED_REUPLOAD;
    default:
      return KYC_CLIENT_DISPLAY_STATUS.PENDING;
  }
}

/**
 * Wraps kyc.service.js's `serializeDocumentForClient` output (or any object
 * carrying `status`/`validUntil`) with the extra `displayStatus` field.
 * Does not re-derive or duplicate the other fields.
 */
function withClientDisplayStatus(serializedDoc, rawDoc) {
  return {
    ...serializedDoc,
    displayStatus: toClientDisplayStatus(rawDoc || serializedDoc),
  };
}

module.exports = { toClientDisplayStatus, withClientDisplayStatus };
