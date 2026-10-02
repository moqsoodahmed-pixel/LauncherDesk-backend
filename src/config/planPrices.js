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
  maxClasses: 10,
}

const APPLICANT_TYPES = Object.keys(TRADEMARK.govtFeePerClass)

/** Returns { classes, feePaise, gstPaise, govtPaise, govtCollected, totalPaise } or null for invalid input. */
function trademarkPrice({ applicantType, classes }) {
  const perClass = TRADEMARK.govtFeePerClass[applicantType]
  const n = Number(classes)
  if (!perClass || !Number.isInteger(n) || n < 1 || n > TRADEMARK.maxClasses) return null
  const feePaise = TRADEMARK.professionalFee * (TRADEMARK.professionalFeePerClass ? n : 1) * 100
  const gstPaise = Math.round(feePaise * GST_RATE)
  const govtPaise = perClass * n * 100
  const govtCollected = !!TRADEMARK.collectGovtFeeOnline
  return {
    classes: n, feePaise, gstPaise, govtPaise, govtCollected,
    totalPaise: feePaise + gstPaise + (govtCollected ? govtPaise : 0),
  }
}

module.exports = { GST_RATE, PLAN_PRICES, SERVICE_TITLES, priceFor, TRADEMARK, APPLICANT_TYPES, trademarkPrice }