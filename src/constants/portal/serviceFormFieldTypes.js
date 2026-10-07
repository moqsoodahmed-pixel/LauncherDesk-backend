/**
 * Allowed field types for a Service's configurable formSchema. Document
 * uploads are deliberately excluded - that belongs to the KYC/document
 * phase, not a generic form field.
 */
const SERVICE_FORM_FIELD_TYPES = Object.freeze([
  'text',
  'textarea',
  'number',
  'email',
  'phone',
  'select',
  'multiselect',
  'checkbox',
  'radio',
  'date',
  'url',
]);

// Field types that must supply a non-empty `options` list.
const FIELD_TYPES_REQUIRING_OPTIONS = Object.freeze(['select', 'multiselect', 'radio']);

module.exports = { SERVICE_FORM_FIELD_TYPES, FIELD_TYPES_REQUIRING_OPTIONS };
