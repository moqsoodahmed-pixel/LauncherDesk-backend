const { SERVICE_FORM_FIELD_TYPES, FIELD_TYPES_REQUIRING_OPTIONS } = require('../../constants/portal/serviceFormFieldTypes');

// letters/numbers/underscore, camelCase-friendly, must start with a letter
// or underscore. Deliberately rejects '$', '.', spaces, and anything else
// that could act as a Mongo operator or path separator.
const SAFE_FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Validates a `formSchema` document structurally. Returns an array of
 * human-readable error strings (empty = valid). This is configuration
 * DATA only - nothing here is ever compiled or executed; `pattern` is
 * stored as a plain string and is never turned into a RegExp or run
 * against user input in this phase.
 */
function validateFormSchema(formSchema) {
  const errors = [];
  if (formSchema === undefined || formSchema === null) return errors;

  if (typeof formSchema !== 'object' || Array.isArray(formSchema)) {
    return ['formSchema must be an object with a "fields" array.'];
  }
  const fields = formSchema.fields;
  if (fields === undefined) return errors; // fields defaults to [] elsewhere
  if (!Array.isArray(fields)) {
    return ['formSchema.fields must be an array.'];
  }

  const seenKeys = new Set();

  fields.forEach((field, index) => {
    const at = `formSchema.fields[${index}]`;

    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      errors.push(`${at} must be an object.`);
      return;
    }

    if (typeof field.key !== 'string' || !SAFE_FIELD_KEY.test(field.key)) {
      errors.push(`${at}.key must be letters/numbers/underscore, starting with a letter or underscore (got: ${JSON.stringify(field.key)}).`);
    } else if (seenKeys.has(field.key)) {
      errors.push(`${at}.key "${field.key}" is duplicated.`);
    } else {
      seenKeys.add(field.key);
    }

    if (typeof field.label !== 'string' || field.label.trim().length === 0) {
      errors.push(`${at}.label is required.`);
    }

    if (!SERVICE_FORM_FIELD_TYPES.includes(field.type)) {
      errors.push(`${at}.type must be one of: ${SERVICE_FORM_FIELD_TYPES.join(', ')} (got: ${JSON.stringify(field.type)}).`);
    } else if (FIELD_TYPES_REQUIRING_OPTIONS.includes(field.type)) {
      if (!Array.isArray(field.options) || field.options.length === 0 || !field.options.every((o) => typeof o === 'string' && o.length > 0)) {
        errors.push(`${at}.options must be a non-empty array of strings for field type "${field.type}".`);
      }
    }

    for (const numField of ['min', 'max', 'minLength', 'maxLength', 'order']) {
      if (field[numField] !== undefined && field[numField] !== null && typeof field[numField] !== 'number') {
        errors.push(`${at}.${numField} must be a number.`);
      }
    }
    if (field.pattern !== undefined && field.pattern !== null && typeof field.pattern !== 'string') {
      errors.push(`${at}.pattern must be a string.`);
    }
    if (field.required !== undefined && typeof field.required !== 'boolean') {
      errors.push(`${at}.required must be a boolean.`);
    }
    if (field.active !== undefined && typeof field.active !== 'boolean') {
      errors.push(`${at}.active must be a boolean.`);
    }
  });

  return errors;
}

module.exports = { validateFormSchema, SAFE_FIELD_KEY };
