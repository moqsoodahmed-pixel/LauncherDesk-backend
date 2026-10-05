/**
 * E-Stamp ordering — editable settings.
 *
 * FEES: LauncherDesk's own charges added on top of the stamp duty (18% GST is added on these fees, not on the duty).
 *   These are for DISPLAY only — the amount actually charged is calculated by the backend
 *   (launcherdesk-backend/src/config/planPrices.js → ESTAMP). Keep both in sync.
 *   A fee of 0 is hidden from the customer.
 */
export const ESTAMP_FEES = {
  service: 0,   // LauncherDesk service / convenience fee per e-stamp (₹)
  courier: 150, // doorstep delivery of the original stamp paper (₹) — GST INCLUDED, the customer pays exactly this
}

/** Stamp duty values the customer can pick (₹). They can also type a custom value. */
export const DENOMINATIONS = [500, 1000]
export const MAX_DUTY = 100000
export const GST_RATE = 0.18

/** Common document types (customer picks one; our team verifies the duty before purchase). */
export const DOC_TYPES = [
  'Rent / Lease Agreement',
  'Affidavit',
  'General Agreement',
  'Indemnity Bond',
  'Power of Attorney',
  'Partnership Deed',
  'Loan Agreement',
  'MOU / Business Agreement',
  'Employment / Service Agreement',
  'Declaration / Undertaking',
  'Other',
]

/**
 * States & UTs we serve. `script` is the words "stamp paper" in the local script,
 * shown as a subtitle on the state page (left empty where not needed).
 */
export const ESTAMP_STATES = [
  { slug: 'andaman-and-nicobar', name: 'Andaman & Nicobar', script: '' },
  { slug: 'andhra-pradesh',      name: 'Andhra Pradesh',    script: 'ఆంధ్రప్రదేశ్ స్టాంప్ పేపర్' },
  { slug: 'arunachal-pradesh',   name: 'Arunachal Pradesh', script: '' },
  { slug: 'assam',               name: 'Assam',             script: '' },
  { slug: 'bihar',               name: 'Bihar',             script: 'बिहार स्टाम्प पेपर' },
  { slug: 'chhattisgarh',        name: 'Chhattisgarh',      script: 'छत्तीसगढ़ स्टाम्प पेपर' },
  { slug: 'delhi',               name: 'Delhi',             script: 'दिल्ली स्टाम्प पेपर' },
  { slug: 'goa',                 name: 'Goa',               script: '' },
  { slug: 'gujarat',             name: 'Gujarat',           script: 'ગુજરાત સ્ટેમ્પ પેપર' },
  { slug: 'haryana',             name: 'Haryana',           script: 'हरियाणा स्टाम्प पेपर' },
  { slug: 'himachal-pradesh',    name: 'Himachal Pradesh',  script: 'हिमाचल प्रदेश स्टाम्प पेपर' },
  { slug: 'jammu-and-kashmir',   name: 'Jammu & Kashmir',   script: '' },
  { slug: 'jharkhand',           name: 'Jharkhand',         script: 'झारखंड स्टाम्प पेपर' },
  { slug: 'karnataka',           name: 'Karnataka',         script: 'ಕರ್ನಾಟಕದ ಸ್ಟಾಂಪ್ ಪೇಪರ್' },
  { slug: 'kerala',              name: 'Kerala',            script: 'കേരള സ്റ്റാമ്പ് പേപ്പർ' },
  { slug: 'ladakh',              name: 'Ladakh',            script: '' },
  { slug: 'madhya-pradesh',      name: 'Madhya Pradesh',    script: 'मध्य प्रदेश स्टाम्प पेपर' },
  { slug: 'maharashtra',         name: 'Maharashtra',       script: 'महाराष्ट्र स्टॅम्प पेपर' },
  { slug: 'manipur',             name: 'Manipur',           script: '' },
  { slug: 'meghalaya',           name: 'Meghalaya',         script: '' },
  { slug: 'mizoram',             name: 'Mizoram',           script: '' },
  { slug: 'nagaland',            name: 'Nagaland',          script: '' },
  { slug: 'odisha',              name: 'Odisha',            script: 'ଓଡ଼ିଶା ଷ୍ଟାମ୍ପ ପେପର' },
  { slug: 'puducherry',          name: 'Puducherry',        script: 'புதுச்சேரி ஸ்டாம்ப் பேப்பர்' },
  { slug: 'punjab',              name: 'Punjab',            script: 'ਪੰਜਾਬ ਸਟੈਂਪ ਪੇਪਰ' },
  { slug: 'rajasthan',           name: 'Rajasthan',         script: 'राजस्थान स्टाम्प पेपर' },
  { slug: 'sikkim',              name: 'Sikkim',            script: '' },
  { slug: 'tamil-nadu',          name: 'Tamil Nadu',        script: 'தமிழ்நாடு ஸ்டாம்ப் பேப்பர்' },
  { slug: 'telangana',           name: 'Telangana',         script: 'తెలంగాణ స్టాంప్ పేపర్' },
  { slug: 'tripura',             name: 'Tripura',           script: '' },
  { slug: 'uttar-pradesh',       name: 'Uttar Pradesh',     script: 'उत्तर प्रदेश स्टाम्प पेपर' },
  { slug: 'uttarakhand',         name: 'Uttarakhand',       script: 'उत्तराखंड स्टाम्प पेपर' },
  { slug: 'west-bengal',         name: 'West Bengal',       script: 'পশ্চিমবঙ্গ স্ট্যাম্প পেপার' },
]

export const stateBySlug = slug => ESTAMP_STATES.find(s => s.slug === slug)

export const LD_PHONE = '+91 85488 54859'
export const LD_WA = '918548854859'