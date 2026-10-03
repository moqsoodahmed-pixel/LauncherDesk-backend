/**
 * Documents requested from the customer after payment, per service slug.
 * Edit freely — the notification emails and the dashboard read from here.
 */
const KYC = ['PAN card (all directors/partners)', 'Aadhaar card (all directors/partners)', 'Passport-size photograph', 'Address proof (bank statement / utility bill)']
const OFFICE = ['Registered office address proof (electricity bill / rent agreement)', 'NOC from property owner']

const SERVICE_DOCUMENTS = {
  'private-limited-company-registration': [...KYC, ...OFFICE],
  'llp-registration': [...KYC, ...OFFICE],
  'opc-registration': [...KYC, ...OFFICE, 'Nominee PAN & Aadhaar'],
  'partnership-registration': [...KYC, 'Partnership deed draft (if any)', ...OFFICE],
  'gst-registration': ['PAN card of business/proprietor', 'Aadhaar card', 'Passport-size photograph', 'Business address proof', 'Bank statement or cancelled cheque'],
  'msme-registration': ['Aadhaar card of owner', 'PAN card of business/owner'],
  'trademark-registration': ['Brand name / logo file', 'PAN or Aadhaar of applicant', 'MSME certificate (if available)', 'Signed authorisation (TM-48), we will share the draft'],
  'fssai-registration': ['Photo ID of food business operator', 'Address proof of premises', 'List of food products'],
  'iso-certification': ['Company registration certificate', 'GST certificate', 'Scope of business / activities'],
  // e-Stamp: plain stamp paper needs no documents; "print on e-stamp" needs the customer's document
  'e-stamp-paper': [],
  'e-stamp-paper-print': ['Document to be printed on the e-Stamp (PDF or Word)'],
  'startup-india-dpiit': ['Certificate of incorporation', 'Company PAN', 'Brief write-up of the innovation', 'Website or pitch deck (if any)'],
}
const DEFAULT_DOCUMENTS = ['PAN card', 'Aadhaar card']

/** Services that don't need documents (IT, marketing...) → order goes straight to processing. */
const NO_DOCUMENT_PREFIXES = ['website', 'static-website', 'dynamic-website', 'ecommerce-website', 'digital-marketing', 'seo', 'social-media', 'google-ads', 'meta-', 'branding', 'content-', 'software', 'mobile-app', 'whatsapp', 'ai-', 'crm', 'business-automation', 'hrms', 'sms-', 'email-']

function documentsFor(slug = '') {
  if (SERVICE_DOCUMENTS[slug]) return SERVICE_DOCUMENTS[slug]
  if (NO_DOCUMENT_PREFIXES.some(p => slug.startsWith(p))) return []
  return DEFAULT_DOCUMENTS
}

module.exports = { documentsFor, SERVICE_DOCUMENTS }