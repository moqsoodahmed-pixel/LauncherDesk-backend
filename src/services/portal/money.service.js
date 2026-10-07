/**
 * Safe money handling: every stored/stateful amount is an INTEGER in minor
 * units (paise for INR) - never a floating-point rupee value - so pricing
 * math never accumulates binary floating-point rounding error. The only
 * place rupee (major-unit) numbers exist is at the edges: converting a
 * human-entered price on input, and formatting for display on output.
 *
 * This is the ONLY place that computes a service's price/GST/total - a
 * future Order/Payment phase should compute amounts the same way rather
 * than re-implementing the arithmetic, and the frontend must never be
 * trusted to compute a real total itself.
 */

const SUPPORTED_CURRENCIES = Object.freeze(['INR']);
const MINOR_UNITS_PER_MAJOR = 100;

function rupeesToPaise(rupees) {
  // Round at the boundary once, here, rather than carrying fractional
  // paise through further integer math.
  return Math.round(Number(rupees) * MINOR_UNITS_PER_MAJOR);
}

function paiseToRupees(paise) {
  return paise / MINOR_UNITS_PER_MAJOR;
}

/**
 * Computes { basePriceMinor, gstAmountMinor, totalMinor } and their
 * major-unit equivalents for display, using only integer arithmetic.
 */
function computePricingSummary({ basePriceMinor, gstApplicable, gstPercentage, currency = 'INR' }) {
  const baseInput = Number(basePriceMinor);
  const hasConfiguredPrice = basePriceMinor !== null && basePriceMinor !== undefined && Number.isFinite(baseInput);
  const base = hasConfiguredPrice ? Math.round(baseInput) : null;

  const gst = base == null ? null : gstApplicable ? Math.round((base * gstPercentage) / 100) : 0;
  const total = base == null ? null : base + (gst ?? 0);

  return {
    currency,
    basePriceMinor: base,
    gstAmountMinor: gst,
    totalMinor: total,
    basePrice: base == null ? null : paiseToRupees(base),
    gstAmount: gst == null ? null : paiseToRupees(gst),
    total: total == null ? null : paiseToRupees(total),
  };
}

module.exports = { SUPPORTED_CURRENCIES, rupeesToPaise, paiseToRupees, computePricingSummary };
