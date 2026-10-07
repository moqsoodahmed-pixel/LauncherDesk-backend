/**
 * Normalized provider-error categories (services/providerError.service.js
 * maps raw Brevo/MSG91 errors into these) - the ONLY thing
 * communicationProcessor.service.js's retry policy looks at, so it never
 * has to know Brevo/MSG91-specific error shapes.
 */
const PROVIDER_ERROR_CATEGORY = Object.freeze({
  TRANSIENT: 'TRANSIENT', // network timeout, provider 5xx, temporary rate limit -> retryable
  PERMANENT: 'PERMANENT', // invalid recipient, malformed request, permanent rejection -> never retry
  AUTHENTICATION: 'AUTHENTICATION', // invalid/missing credentials -> never retry (won't fix itself)
  RATE_LIMIT: 'RATE_LIMIT', // explicit rate limit -> retryable, with backoff
  UNKNOWN: 'UNKNOWN', // unrecognized shape -> treated as retryable once, bounded like any other
});

const RETRYABLE_CATEGORIES = [PROVIDER_ERROR_CATEGORY.TRANSIENT, PROVIDER_ERROR_CATEGORY.RATE_LIMIT, PROVIDER_ERROR_CATEGORY.UNKNOWN];

module.exports = { PROVIDER_ERROR_CATEGORY, RETRYABLE_CATEGORIES };
