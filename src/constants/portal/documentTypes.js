/**
 * Centralized document-type catalog. Used today only to configure a
 * Service's `requiredDocuments` (what WILL be required later); actual
 * document upload/verification is built in the KYC phase.
 *
 * Enterprise KYC expansion (Part 5): the original 7 values (PAN, AADHAAR,
 * GST_CERTIFICATE, COMPANY_REGISTRATION, ADDRESS_PROOF, BUSINESS_PROOF,
 * OTHER) are kept EXACTLY as-is and are NOT deprecated - a live data check
 * against the local `portal_kyc_documents`/`portal_services` collections
 * (2026-10-08) confirmed PAN, GST_CERTIFICATE, ADDRESS_PROOF, and
 * COMPANY_REGISTRATION are referenced by real Service.requiredDocuments
 * snapshots and real KycDocument rows today, so none of the 7 original
 * values may ever be removed or renamed. AADHAAR/BUSINESS_PROOF/OTHER have
 * no live references but are kept too, unconditionally, per instruction.
 *
 * Everything below the original 7 is NEW and purely additive - it expands
 * the catalog for the enterprise business-type-driven requirements
 * resolver (see services/portal/kycRequirements.service.js) and the
 * future admin/client KYC dashboards. Existing Service.requiredDocuments
 * snapshots that reference only the original 7 values are completely
 * unaffected by this addition.
 */
const DOCUMENT_TYPES = Object.freeze({
  // ── Original catalog (DO NOT rename/remove - see note above) ───────────
  PAN: 'PAN',
  AADHAAR: 'AADHAAR',
  GST_CERTIFICATE: 'GST_CERTIFICATE',
  COMPANY_REGISTRATION: 'COMPANY_REGISTRATION',
  ADDRESS_PROOF: 'ADDRESS_PROOF',
  BUSINESS_PROOF: 'BUSINESS_PROOF',
  OTHER: 'OTHER',

  // ── Identity documents ──────────────────────────────────────────────────
  PAN_CARD: 'PAN_CARD',
  AADHAAR_FRONT: 'AADHAAR_FRONT',
  AADHAAR_BACK: 'AADHAAR_BACK',
  PASSPORT: 'PASSPORT',
  DRIVING_LICENSE: 'DRIVING_LICENSE',
  VOTER_ID: 'VOTER_ID',

  // ── Business / entity registration documents ────────────────────────────
  BUSINESS_REGISTRATION: 'BUSINESS_REGISTRATION',
  INCORPORATION_CERTIFICATE: 'INCORPORATION_CERTIFICATE',
  MSME_CERTIFICATE: 'MSME_CERTIFICATE',
  TRADEMARK_CERTIFICATE: 'TRADEMARK_CERTIFICATE',
  SHOP_LICENSE: 'SHOP_LICENSE',
  PARTNERSHIP_DEED: 'PARTNERSHIP_DEED',
  LLP_AGREEMENT: 'LLP_AGREEMENT',
  MOA: 'MOA',
  AOA: 'AOA',
  BOARD_RESOLUTION: 'BOARD_RESOLUTION',

  // ── Banking documents ────────────────────────────────────────────────────
  BANK_PASSBOOK: 'BANK_PASSBOOK',
  CANCELLED_CHEQUE: 'CANCELLED_CHEQUE',
  CURRENT_ACCOUNT_STATEMENT: 'CURRENT_ACCOUNT_STATEMENT',

  // ── Address / premises proof ─────────────────────────────────────────────
  UTILITY_BILL: 'UTILITY_BILL',
  OFFICE_PHOTO: 'OFFICE_PHOTO',

  // ── Signatory / authorization documents ──────────────────────────────────
  OWNER_PHOTO: 'OWNER_PHOTO',
  AUTHORIZED_SIGNATORY: 'AUTHORIZED_SIGNATORY',
  DIGITAL_SIGNATURE: 'DIGITAL_SIGNATURE',

  // ── Catch-all ─────────────────────────────────────────────────────────────
  ADDITIONAL_DOCUMENT: 'ADDITIONAL_DOCUMENT',
  OTHER_DOCUMENT: 'OTHER_DOCUMENT',
});

const ALL_DOCUMENT_TYPES = Object.values(DOCUMENT_TYPES);

module.exports = { DOCUMENT_TYPES, ALL_DOCUMENT_TYPES };
