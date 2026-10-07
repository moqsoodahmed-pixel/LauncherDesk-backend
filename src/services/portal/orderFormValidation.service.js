const AppError = require('../../utils/portal/AppError');
const { SAFE_FIELD_KEY } = require('./formSchema.service');

const MAX_PAYLOAD_JSON_LENGTH = 20000; // generous cap against abuse, not a real-world form size
const MAX_STRING_LENGTH = 5000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-\s()]{6,20}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

/**
 * The single, reusable place that validates a submitted `orderDetails`
 * payload against a Service's configured `formSchema`. Called from
 * orders.service.js for BOTH the internal (Super Admin/Admin) and
 * client-facing order-creation paths - never duplicated.
 *
 * `formSchema` is configuration DATA (Phase 4) - nothing here ever
 * executes it; every field is checked with plain, fixed comparisons.
 * Throws AppError.badRequest with per-field details on any violation.
 * Returns the validated (and only the validated) orderDetails object -
 * any key not defined in the schema is dropped, not merely ignored, so a
 * client can never smuggle extra data into order storage this way.
 */
function validateOrderDetails(formSchema, orderDetails) {
  const raw = orderDetails && typeof orderDetails === 'object' && !Array.isArray(orderDetails) ? orderDetails : {};

  if (JSON.stringify(raw).length > MAX_PAYLOAD_JSON_LENGTH) {
    throw AppError.badRequest('orderDetails payload is too large.');
  }

  const fields = (formSchema?.fields || []).filter((f) => f.active !== false);
  const errors = [];
  const cleaned = {};

  for (const field of fields) {
    if (!SAFE_FIELD_KEY.test(field.key)) {
      // Defence in depth - formSchema.service.js already guarantees this
      // at the point a Service's schema is saved, so this should never
      // actually trigger, but orderDetails is never built from an unsafe
      // key either way.
      continue;
    }

    const value = raw[field.key];
    const present = value !== undefined && value !== null && value !== '';

    if (field.required && !present) {
      errors.push({ field: field.key, message: `${field.label} is required.` });
      continue;
    }
    if (!present) continue; // optional and not supplied - fine, omit from cleaned

    const error = validateFieldValue(field, value);
    if (error) {
      errors.push({ field: field.key, message: error });
      continue;
    }

    cleaned[field.key] = normalizeFieldValue(field, value);
  }

  if (errors.length > 0) {
    throw AppError.badRequest('Invalid order details.', errors);
  }

  return cleaned;
}

function validateFieldValue(field, value) {
  switch (field.type) {
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') return `${field.label} must be text.`;
      if (value.length > (field.maxLength ?? MAX_STRING_LENGTH)) return `${field.label} is too long.`;
      if (field.minLength && value.length < field.minLength) return `${field.label} must be at least ${field.minLength} characters.`;
      return null;

    case 'email':
      if (typeof value !== 'string' || !EMAIL_RE.test(value)) return `${field.label} must be a valid email address.`;
      return null;

    case 'phone':
      if (typeof value !== 'string' || !PHONE_RE.test(value)) return `${field.label} must be a valid phone number.`;
      return null;

    case 'url':
      if (typeof value !== 'string' || !URL_RE.test(value)) return `${field.label} must be a valid URL.`;
      return null;

    case 'number': {
      const num = Number(value);
      if (typeof value === 'boolean' || value === '' || Number.isNaN(num)) return `${field.label} must be a number.`;
      if (field.min !== null && field.min !== undefined && num < field.min) return `${field.label} must be at least ${field.min}.`;
      if (field.max !== null && field.max !== undefined && num > field.max) return `${field.label} must be at most ${field.max}.`;
      return null;
    }

    case 'date':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return `${field.label} must be a valid date.`;
      return null;

    case 'checkbox':
      if (typeof value !== 'boolean') return `${field.label} must be true or false.`;
      return null;

    case 'select':
    case 'radio':
      if (typeof value !== 'string' || !(field.options || []).includes(value)) {
        return `${field.label} must be one of: ${(field.options || []).join(', ')}.`;
      }
      return null;

    case 'multiselect': {
      if (!Array.isArray(value) || value.length === 0) return `${field.label} must be a non-empty list.`;
      const invalid = value.filter((v) => !(field.options || []).includes(v));
      if (invalid.length > 0) return `${field.label} contains an invalid option: ${invalid.join(', ')}.`;
      return null;
    }

    default:
      return `${field.label} has an unsupported field type.`;
  }
}

function normalizeFieldValue(field, value) {
  if (field.type === 'number') return Number(value);
  if (field.type === 'text' || field.type === 'textarea' || field.type === 'email' || field.type === 'phone' || field.type === 'url') {
    return String(value).trim();
  }
  return value;
}

module.exports = { validateOrderDetails, MAX_PAYLOAD_JSON_LENGTH };
