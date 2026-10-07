/**
 * Centralized recursive redaction, used by BOTH auditLog.service.js and
 * notification.service.js so there is exactly one place that decides what
 * counts as a sensitive key - never duplicated per-caller.
 *
 * Matches by substring (case-insensitive) against key names, not exact
 * names, so `razorpaySignature`, `BREVO_API_KEY`, `refreshToken`,
 * `authKey`, etc. are all caught without enumerating every variant.
 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwordhash',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'authkey',
  'jwt',
  'signature',
  'storagekey',
  'cvv',
  'cardnumber',
  'otp',
];

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function isSensitiveKey(key) {
  // Strip underscores/dashes before matching so `BREVO_API_KEY`,
  // `auth-key`, `MSG91_AUTH_KEY` etc. all normalize to the same
  // substring space as `apikey`/`authkey` - a literal substring match
  // alone misses every SCREAMING_SNAKE_CASE env-var-style key name.
  const normalized = String(key).toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function sanitizeMetadata(value, depth = 0) {
  if (depth >= MAX_DEPTH || value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item, depth + 1));
  }

  if (value instanceof Date || typeof value !== 'object') {
    return value;
  }

  // Mongoose ObjectId / Buffer / other non-plain objects - never recurse
  // into their internals, just pass through as-is (they aren't where
  // secrets would ever live, and recursing risks breaking their shape).
  if (typeof value.toHexString === 'function' || Buffer.isBuffer(value)) {
    return value;
  }

  const clean = {};
  for (const [key, val] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      clean[key] = REDACTED;
    } else {
      clean[key] = sanitizeMetadata(val, depth + 1);
    }
  }
  return clean;
}

module.exports = { sanitizeMetadata };
