const AppError = require('../../utils/portal/AppError');
const { REPORT_PERIOD } = require('../../constants/portal/reportPeriods');

/**
 * Single consistent timezone strategy for all reporting: every calendar
 * boundary (start of "today", "this month", etc.) is computed in UTC.
 * The rest of this app already stores/compares dates in UTC (no explicit
 * per-user timezone anywhere), so reports follow the same convention
 * rather than inventing a second, inconsistent one.
 */
const REPORT_TIMEZONE = 'UTC';

const MAX_CUSTOM_RANGE_DAYS = 366 * 2; // 2 years - prevents an unbounded/runaway aggregation

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

/**
 * Resolves a report query's `period`/`from`/`to` into a concrete, validated
 * `{ from, to }` Date range plus metadata for the response envelope. Never
 * trusts `from`/`to` without validating them (valid ISO8601, from <= to,
 * range not absurdly large for CUSTOM).
 */
function resolveDateRange({ period, from, to } = {}) {
  const now = new Date();

  if (period && period !== REPORT_PERIOD.CUSTOM) {
    switch (period) {
      case REPORT_PERIOD.TODAY:
        return { from: startOfUtcDay(now), to: endOfUtcDay(now), period };
      case REPORT_PERIOD.YESTERDAY: {
        const yesterday = new Date(now);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        return { from: startOfUtcDay(yesterday), to: endOfUtcDay(yesterday), period };
      }
      case REPORT_PERIOD.LAST_7_DAYS: {
        const start = new Date(now);
        start.setUTCDate(start.getUTCDate() - 6); // inclusive of today = 7 days total
        return { from: startOfUtcDay(start), to: endOfUtcDay(now), period };
      }
      case REPORT_PERIOD.LAST_30_DAYS: {
        const start = new Date(now);
        start.setUTCDate(start.getUTCDate() - 29);
        return { from: startOfUtcDay(start), to: endOfUtcDay(now), period };
      }
      case REPORT_PERIOD.THIS_MONTH: {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return { from: start, to: endOfUtcDay(now), period };
      }
      case REPORT_PERIOD.LAST_MONTH: {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
        return { from: start, to: end, period };
      }
      case REPORT_PERIOD.THIS_YEAR: {
        const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        return { from: start, to: endOfUtcDay(now), period };
      }
      default:
        throw AppError.badRequest(`Unknown report period: ${period}.`);
    }
  }

  // CUSTOM (or no period given but from/to supplied).
  if (!from || !to) {
    // Default fallback: last 30 days - a report must always have SOME
    // bounded range, never an unbounded all-time scan by default.
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 29);
    return { from: startOfUtcDay(start), to: endOfUtcDay(now), period: REPORT_PERIOD.LAST_30_DAYS };
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw AppError.badRequest('Invalid from/to date.');
  }
  if (fromDate.getTime() > toDate.getTime()) {
    throw AppError.badRequest('from must not be after to.');
  }
  const rangeDays = (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000);
  if (rangeDays > MAX_CUSTOM_RANGE_DAYS) {
    throw AppError.badRequest(`Custom date range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days.`);
  }

  return { from: startOfUtcDay(fromDate), to: endOfUtcDay(toDate), period: REPORT_PERIOD.CUSTOM };
}

function reportMeta({ from, to, period }) {
  return { from: from.toISOString(), to: to.toISOString(), period, timezone: REPORT_TIMEZONE, generatedAt: new Date().toISOString() };
}

module.exports = { resolveDateRange, reportMeta, REPORT_TIMEZONE, MAX_CUSTOM_RANGE_DAYS };
