const { PROVIDER_ERROR_CATEGORY } = require('../../constants/portal/providerErrorCategory');

/**
 * Normalizes a raw error thrown by any communication provider adapter
 * (Brevo/MSG91 HTTP calls, or the Development providers) into a single
 * shape communicationProcessor.service.js's retry policy understands,
 * so it never needs to know provider-specific error shapes.
 */
function normalizeProviderError(err) {
  const status = err?.status || err?.statusCode || err?.response?.status;
  const message = err?.message || 'Unknown provider error.';

  if (status === 401 || status === 403 || /invalid.*(api.?key|credential|auth)/i.test(message)) {
    return { category: PROVIDER_ERROR_CATEGORY.AUTHENTICATION, code: String(status || 'AUTH'), message, retryable: false };
  }
  if (status === 429 || /rate.?limit/i.test(message)) {
    return { category: PROVIDER_ERROR_CATEGORY.RATE_LIMIT, code: String(status || 'RATE_LIMIT'), message, retryable: true };
  }
  if (status >= 500 || /timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(message)) {
    return { category: PROVIDER_ERROR_CATEGORY.TRANSIENT, code: String(status || 'TRANSIENT'), message, retryable: true };
  }
  if (status >= 400 && status < 500) {
    return { category: PROVIDER_ERROR_CATEGORY.PERMANENT, code: String(status), message, retryable: false };
  }
  return { category: PROVIDER_ERROR_CATEGORY.UNKNOWN, code: 'UNKNOWN', message, retryable: true };
}

module.exports = { normalizeProviderError };
