/**
 * Centralized document-type catalog. Used today only to configure a
 * Service's `requiredDocuments` (what WILL be required later); actual
 * document upload/verification is built in the KYC phase.
 */
const DOCUMENT_TYPES = Object.freeze({
  PAN: 'PAN',
  AADHAAR: 'AADHAAR',
  GST_CERTIFICATE: 'GST_CERTIFICATE',
  COMPANY_REGISTRATION: 'COMPANY_REGISTRATION',
  ADDRESS_PROOF: 'ADDRESS_PROOF',
  BUSINESS_PROOF: 'BUSINESS_PROOF',
  OTHER: 'OTHER',
});

const ALL_DOCUMENT_TYPES = Object.values(DOCUMENT_TYPES);

module.exports = { DOCUMENT_TYPES, ALL_DOCUMENT_TYPES };
