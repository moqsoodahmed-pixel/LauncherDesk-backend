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

module.exports = { GST_RATE, PLAN_PRICES, SERVICE_TITLES, priceFor }