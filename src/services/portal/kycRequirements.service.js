const { DOCUMENT_TYPES } = require('../../constants/portal/documentTypes');
const { BUSINESS_TYPES } = require('../../constants/portal/businessTypes');

/**
 * NEW, additive capability (Part 5 enterprise KYC). Resolves "which
 * document types are even relevant to THIS client", purely from the
 * client's own business profile (businessType + gst.applicable + whether
 * they're a foreign client) - completely independent of any specific
 * order's Service.requiredDocuments snapshot, which remains the one and
 * only mechanism that actually gates order KYC upload/verification
 * (services/portal/kyc.service.js, kycState.service.js are untouched by
 * this module).
 *
 * This is a pure function with no DB access - it is intentionally a
 * calculator, not a persisted/cached aggregate, so the mapping table below
 * can be revised at any time with zero migration.
 *
 * ── Mapping table (audit/adjust here) ───────────────────────────────────
 * Every business type gets a baseline of personal-identity documents for
 * the authorized signatory (PAN_CARD + AADHAAR_FRONT/BACK), plus an
 * entity-specific set, plus GST_CERTIFICATE only when gstApplicable, plus
 * PASSPORT instead of Aadhaar/PAN when isForeign.
 *
 *   INDIVIDUAL / FREELANCER / SOLE_PROPRIETOR:
 *     PAN_CARD, AADHAAR_FRONT, AADHAAR_BACK, ADDRESS_PROOF
 *     (+ GST_CERTIFICATE if gstApplicable)
 *
 *   STARTUP / PRIVATE_LIMITED:
 *     PAN_CARD, AADHAAR_FRONT, AADHAAR_BACK, INCORPORATION_CERTIFICATE,
 *     MOA, AOA, BOARD_RESOLUTION, BANK_PASSBOOK/CANCELLED_CHEQUE,
 *     AUTHORIZED_SIGNATORY (+ GST_CERTIFICATE if gstApplicable)
 *
 *   LLP:
 *     PAN_CARD, AADHAAR_FRONT, AADHAAR_BACK, LLP_AGREEMENT,
 *     INCORPORATION_CERTIFICATE, BANK_PASSBOOK, AUTHORIZED_SIGNATORY
 *     (+ GST_CERTIFICATE if gstApplicable)
 *
 *   PARTNERSHIP:
 *     PAN_CARD, AADHAAR_FRONT, AADHAAR_BACK, PARTNERSHIP_DEED,
 *     BANK_PASSBOOK (+ GST_CERTIFICATE if gstApplicable)
 *
 *   NGO / TRUST:
 *     PAN_CARD, AADHAAR_FRONT, AADHAAR_BACK, INCORPORATION_CERTIFICATE
 *     (registration/trust-deed equivalent), BANK_PASSBOOK,
 *     AUTHORIZED_SIGNATORY (GST rarely applicable, still honored if set)
 *
 *   GOVERNMENT_ORGANIZATION / EDUCATIONAL_INSTITUTION:
 *     INCORPORATION_CERTIFICATE (registration/affiliation proof),
 *     AUTHORIZED_SIGNATORY, OFFICE_PHOTO, BANK_PASSBOOK
 *     (no personal Aadhaar/PAN baseline - institutional, not individual)
 *
 *   FOREIGN_CLIENT:
 *     PASSPORT, ADDRESS_PROOF, BUSINESS_REGISTRATION (if operating as a
 *     business), BANK_PASSBOOK - never PAN/AADHAAR (not applicable)
 *
 * Any business type not listed above (defensive default) falls back to
 * the INDIVIDUAL baseline.
 * ─────────────────────────────────────────────────────────────────────────
 */

const BASELINE_INDIVIDUAL = [DOCUMENT_TYPES.PAN_CARD, DOCUMENT_TYPES.AADHAAR_FRONT, DOCUMENT_TYPES.AADHAAR_BACK, DOCUMENT_TYPES.ADDRESS_PROOF];

const REQUIREMENTS_BY_BUSINESS_TYPE = Object.freeze({
  [BUSINESS_TYPES.INDIVIDUAL]: BASELINE_INDIVIDUAL,
  [BUSINESS_TYPES.FREELANCER]: BASELINE_INDIVIDUAL,
  [BUSINESS_TYPES.SOLE_PROPRIETOR]: [...BASELINE_INDIVIDUAL, DOCUMENT_TYPES.BUSINESS_REGISTRATION],

  [BUSINESS_TYPES.STARTUP]: [
    DOCUMENT_TYPES.PAN_CARD,
    DOCUMENT_TYPES.AADHAAR_FRONT,
    DOCUMENT_TYPES.AADHAAR_BACK,
    DOCUMENT_TYPES.INCORPORATION_CERTIFICATE,
    DOCUMENT_TYPES.MOA,
    DOCUMENT_TYPES.AOA,
    DOCUMENT_TYPES.BOARD_RESOLUTION,
    DOCUMENT_TYPES.BANK_PASSBOOK,
    DOCUMENT_TYPES.CANCELLED_CHEQUE,
    DOCUMENT_TYPES.AUTHORIZED_SIGNATORY,
  ],

  [BUSINESS_TYPES.PRIVATE_LIMITED]: [
    DOCUMENT_TYPES.PAN_CARD,
    DOCUMENT_TYPES.AADHAAR_FRONT,
    DOCUMENT_TYPES.AADHAAR_BACK,
    DOCUMENT_TYPES.INCORPORATION_CERTIFICATE,
    DOCUMENT_TYPES.MOA,
    DOCUMENT_TYPES.AOA,
    DOCUMENT_TYPES.BOARD_RESOLUTION,
    DOCUMENT_TYPES.BANK_PASSBOOK,
    DOCUMENT_TYPES.CANCELLED_CHEQUE,
    DOCUMENT_TYPES.AUTHORIZED_SIGNATORY,
  ],

  [BUSINESS_TYPES.LLP]: [
    DOCUMENT_TYPES.PAN_CARD,
    DOCUMENT_TYPES.AADHAAR_FRONT,
    DOCUMENT_TYPES.AADHAAR_BACK,
    DOCUMENT_TYPES.LLP_AGREEMENT,
    DOCUMENT_TYPES.INCORPORATION_CERTIFICATE,
    DOCUMENT_TYPES.BANK_PASSBOOK,
    DOCUMENT_TYPES.AUTHORIZED_SIGNATORY,
  ],

  [BUSINESS_TYPES.PARTNERSHIP]: [
    DOCUMENT_TYPES.PAN_CARD,
    DOCUMENT_TYPES.AADHAAR_FRONT,
    DOCUMENT_TYPES.AADHAAR_BACK,
    DOCUMENT_TYPES.PARTNERSHIP_DEED,
    DOCUMENT_TYPES.BANK_PASSBOOK,
  ],

  [BUSINESS_TYPES.NGO]: [
    DOCUMENT_TYPES.PAN_CARD,
    DOCUMENT_TYPES.AADHAAR_FRONT,
    DOCUMENT_TYPES.AADHAAR_BACK,
    DOCUMENT_TYPES.INCORPORATION_CERTIFICATE,
    DOCUMENT_TYPES.BANK_PASSBOOK,
    DOCUMENT_TYPES.AUTHORIZED_SIGNATORY,
  ],

  [BUSINESS_TYPES.TRUST]: [
    DOCUMENT_TYPES.PAN_CARD,
    DOCUMENT_TYPES.AADHAAR_FRONT,
    DOCUMENT_TYPES.AADHAAR_BACK,
    DOCUMENT_TYPES.INCORPORATION_CERTIFICATE,
    DOCUMENT_TYPES.BANK_PASSBOOK,
    DOCUMENT_TYPES.AUTHORIZED_SIGNATORY,
  ],

  [BUSINESS_TYPES.GOVERNMENT_ORGANIZATION]: [
    DOCUMENT_TYPES.INCORPORATION_CERTIFICATE,
    DOCUMENT_TYPES.AUTHORIZED_SIGNATORY,
    DOCUMENT_TYPES.OFFICE_PHOTO,
    DOCUMENT_TYPES.BANK_PASSBOOK,
  ],

  [BUSINESS_TYPES.EDUCATIONAL_INSTITUTION]: [
    DOCUMENT_TYPES.INCORPORATION_CERTIFICATE,
    DOCUMENT_TYPES.AUTHORIZED_SIGNATORY,
    DOCUMENT_TYPES.OFFICE_PHOTO,
    DOCUMENT_TYPES.BANK_PASSBOOK,
  ],

  [BUSINESS_TYPES.FOREIGN_CLIENT]: [
    DOCUMENT_TYPES.PASSPORT,
    DOCUMENT_TYPES.ADDRESS_PROOF,
    DOCUMENT_TYPES.BUSINESS_REGISTRATION,
    DOCUMENT_TYPES.BANK_PASSBOOK,
  ],
});

/**
 * @param {Object} input
 * @param {string|null} input.businessType - one of BUSINESS_TYPES, or null/unset
 * @param {boolean} [input.gstApplicable] - mirrors Client.gst.applicable
 * @param {boolean} [input.isForeign] - true forces the FOREIGN_CLIENT document set regardless of businessType
 * @returns {{businessType: string|null, gstApplicable: boolean, documentTypes: string[]}}
 */
function resolveRequiredDocumentTypes({ businessType = null, gstApplicable = false, isForeign = false } = {}) {
  const effectiveType = isForeign ? BUSINESS_TYPES.FOREIGN_CLIENT : businessType;
  const base = REQUIREMENTS_BY_BUSINESS_TYPE[effectiveType] || BASELINE_INDIVIDUAL;

  const documentTypes = [...base];
  const isGstEligible = effectiveType !== BUSINESS_TYPES.FOREIGN_CLIENT
    && effectiveType !== BUSINESS_TYPES.GOVERNMENT_ORGANIZATION
    && effectiveType !== BUSINESS_TYPES.EDUCATIONAL_INSTITUTION;
  if (gstApplicable && isGstEligible && !documentTypes.includes(DOCUMENT_TYPES.GST_CERTIFICATE)) {
    documentTypes.push(DOCUMENT_TYPES.GST_CERTIFICATE);
  }

  return {
    businessType: businessType || null,
    gstApplicable: !!gstApplicable,
    documentTypes,
  };
}

/** Convenience wrapper that resolves directly from a PortalClient document/lean object. */
function resolveRequiredDocumentTypesForClient(client) {
  return resolveRequiredDocumentTypes({
    businessType: client?.businessType || null,
    gstApplicable: !!client?.gst?.applicable,
    isForeign: client?.businessType === BUSINESS_TYPES.FOREIGN_CLIENT,
  });
}

module.exports = {
  REQUIREMENTS_BY_BUSINESS_TYPE,
  resolveRequiredDocumentTypes,
  resolveRequiredDocumentTypesForClient,
};
