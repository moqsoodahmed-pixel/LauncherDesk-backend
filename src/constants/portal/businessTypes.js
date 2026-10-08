/**
 * Business-type catalog for a Client's own profile (new, additive - Part 5
 * of the enterprise KYC engagement). Drives `services/portal/kycRequirements
 * .service.js`'s resolution of "which document types are even relevant to
 * this client", independent of any specific order's Service.requiredDocuments
 * snapshot (which stays exactly as it is today).
 *
 * GST-registration status is NOT duplicated here - the existing
 * `Client.gst.applicable` boolean (models/portal/Client.model.js) already
 * captures it and is reused as-is by the requirements resolver.
 */
const BUSINESS_TYPES = Object.freeze({
  INDIVIDUAL: 'INDIVIDUAL',
  FREELANCER: 'FREELANCER',
  STARTUP: 'STARTUP',
  PRIVATE_LIMITED: 'PRIVATE_LIMITED',
  LLP: 'LLP',
  PARTNERSHIP: 'PARTNERSHIP',
  NGO: 'NGO',
  TRUST: 'TRUST',
  SOLE_PROPRIETOR: 'SOLE_PROPRIETOR',
  GOVERNMENT_ORGANIZATION: 'GOVERNMENT_ORGANIZATION',
  EDUCATIONAL_INSTITUTION: 'EDUCATIONAL_INSTITUTION',
  FOREIGN_CLIENT: 'FOREIGN_CLIENT',
});

const ALL_BUSINESS_TYPES = Object.values(BUSINESS_TYPES);

module.exports = { BUSINESS_TYPES, ALL_BUSINESS_TYPES };
