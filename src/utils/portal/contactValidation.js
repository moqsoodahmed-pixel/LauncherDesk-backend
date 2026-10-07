const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_PATTERN.test(email.trim());
}

/**
 * Normalizes a phone number for MSG91 (digits only, with country code, no
 * leading '+'). Returns null for anything that doesn't look like a usable
 * number rather than silently sending to a malformed destination.
 * Supports Indian 10-digit numbers (defaults to country code 91) and
 * already-international numbers (10-15 digits, any leading country code).
 */
function normalizePhone(phone) {
  if (typeof phone !== 'string') return null;
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) return null;

  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }
  return null;
}

module.exports = { isValidEmail, normalizePhone };
