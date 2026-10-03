/**
 * Server-side price list for checkout.
 *
 * The browser only sends WHICH plan was picked (service slug + tier). The amount
 * charged is always calculated here, so nobody can change the price by editing
 * the request. Keep these numbers in sync with the plan cards on the website
 * (frontend: src/data/registrationPlans.js).
 */
const GST_RATE = 0.18

// Professional fee in rupees, before GST.
const PLAN_PRICES = {
  'private-limited-company-registration': { Basic: 4999, Standard: 6499, Premium: 11499 },
  'opc-registration':                     { Basic: 4999, Standard: 6499, Premium: 11499 },
  'llp-registration':                     { Basic: 4999, Standard: 6499, Premium: 11499 },
}

const SERVICE_TITLES = {
  'private-limited-company-registration': 'Private Limited Company Registration',
  'opc-registration':                     'One Person Company Registration',
  'llp-registration':                     'LLP Registration',
}

/** Returns { feePaise, gstPaise, totalPaise, feeRupees } or null if the plan is unknown. */
function priceFor(serviceSlug, tier) {
  const fee = PLAN_PRICES[serviceSlug]?.[tier]
  if (!fee) return null
  const feePaise = fee * 100
  const gstPaise = Math.round(feePaise * GST_RATE)
  return { feeRupees: fee, feePaise, gstPaise, totalPaise: feePaise + gstPaise }
}

/* ── Trademark registration ───────────────────────────────────────────────────
 * Amount charged online = LauncherDesk professional fee + 18% GST
 *                         + the government fee (IP India, Form TM-A, per class).
 * GST is charged on the professional fee ONLY. The government fee is passed
 * through at actual and is shown on the invoice as its own line.
 * The government fee depends on who is applying and how many classes — it is
 * the same in every city, so city is collected for follow-up, not for pricing.
 * Keep professionalFee in sync with the price on the trademark page
 * (frontend: priceCard in src/data/services.js).
 */
const TRADEMARK = {
  slug: 'trademark-registration',
  title: 'Trademark Registration',
  professionalFee: 1999,
  professionalFeePerClass: false,           // true = ₹1,999 is charged for every class
  govtFeePerClass: { small: 4500, other: 9000 },
  collectGovtFeeOnline: true,               // false = charge fee + GST only, govt fee paid separately
  maxClasses: 45,                           // all 45 Nice classes can be chosen
}

const APPLICANT_TYPES = Object.keys(TRADEMARK.govtFeePerClass)

/** Cleans a list of class numbers: whole numbers 1–45, no duplicates, sorted. null if invalid. */
function cleanClassNumbers(list) {
  if (list == null) return []
  if (!Array.isArray(list)) return null
  const nums = list.map(Number)
  if (nums.some(n => !Number.isInteger(n) || n < 1 || n > 45)) return null
  return [...new Set(nums)].sort((a, b) => a - b)
}

/**
 * Returns { classes, classNumbers, feePaise, gstPaise, govtPaise, govtCollected, totalPaise } or null for invalid input.
 * When classNumbers are sent (e.g. [9, 25, 35]) the class count comes from that list.
 */
function trademarkPrice({ applicantType, classes, classNumbers }) {
  const perClass = TRADEMARK.govtFeePerClass[applicantType]
  const picked = cleanClassNumbers(classNumbers)
  if (picked === null) return null
  const n = picked.length || Number(classes)
  if (!perClass || !Number.isInteger(n) || n < 1 || n > TRADEMARK.maxClasses) return null
  const feePaise = TRADEMARK.professionalFee * (TRADEMARK.professionalFeePerClass ? n : 1) * 100
  const gstPaise = Math.round(feePaise * GST_RATE)
  const govtPaise = perClass * n * 100
  const govtCollected = !!TRADEMARK.collectGovtFeeOnline
  return {
    classes: n, classNumbers: picked, feePaise, gstPaise, govtPaise, govtCollected,
    totalPaise: feePaise + gstPaise + (govtCollected ? govtPaise : 0),
  }
}

/** Simple service price shown as "₹X + GST": fee + 18% GST, in paise. */
function priceWithGst(rupees) {
  const feePaise = Math.round(Number(rupees) * 100)
  const gstPaise = Math.round(feePaise * GST_RATE)
  return { feePaise, gstPaise, totalPaise: feePaise + gstPaise }
}

/* ── e-Stamp paper ───────────────────────────────────────────────────────────
 * Amount charged online = stamp duty (chosen by the customer, passed through at
 * actual, no GST) + LauncherDesk service fee + courier fee (if doorstep delivery)
 * + 18% GST on LauncherDesk's fees only.
 * ⚠ Set serviceFee / courierFee to your real prices, and keep them in sync with
 *   ESTAMP_FEES in the frontend (src/data/estamp.js), which is display-only.
 */
const ESTAMP = {
  serviceFee: 0,
  courierFee: 0,
  minDuty: 1,
  maxDuty: 100000,
  states: [
    'andaman-and-nicobar', 'andhra-pradesh', 'arunachal-pradesh', 'assam', 'bihar', 'delhi', 'gujarat', 'haryana',
    'himachal-pradesh', 'jammu-and-kashmir', 'jharkhand', 'karnataka', 'ladakh', 'madhya-pradesh', 'maharashtra',
    'manipur', 'meghalaya', 'puducherry', 'punjab', 'rajasthan', 'tamil-nadu', 'telangana', 'uttar-pradesh',
    'uttarakhand', 'west-bengal',
  ],
}

/** Returns { dutyPaise, feePaise, gstPaise, totalPaise } or null for invalid input. */
function estampPrice({ stampDuty, delivery }) {
  const duty = Number(stampDuty)
  if (!Number.isInteger(duty) || duty < ESTAMP.minDuty || duty > ESTAMP.maxDuty) return null
  if (!['email', 'courier'].includes(delivery)) return null
  const feePaise = (ESTAMP.serviceFee + (delivery === 'courier' ? ESTAMP.courierFee : 0)) * 100
  const gstPaise = Math.round(feePaise * GST_RATE)
  const dutyPaise = duty * 100
  return { dutyPaise, feePaise, gstPaise, totalPaise: dutyPaise + feePaise + gstPaise }
}

module.exports = { GST_RATE, PLAN_PRICES, SERVICE_TITLES, priceFor, priceWithGst, TRADEMARK, APPLICANT_TYPES, trademarkPrice, cleanClassNumbers, ESTAMP, estampPrice }