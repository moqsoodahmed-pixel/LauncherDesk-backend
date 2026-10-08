/**
 * The ONLY template interpolation mechanism used for communication
 * templates. Deliberately NOT a general templating engine: no eval(), no
 * Function(), no arbitrary expression evaluation - `{{key}}` is replaced
 * only when `key` is a simple alphanumeric/underscore identifier AND is
 * present in the explicit `variables` object. Anything else (including an
 * attempted `{{constructor.constructor('...')()}}` injection) simply fails
 * to match the regex and is left as literal, inert text.
 */
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

/**
 * `options.escapeHtml` (default false): when the interpolated value is going
 * into an HTML document (the email body), caller-supplied values (e.g. a
 * Client's own `name`, a ticket subject) must be HTML-escaped so a value
 * like `<script>alert(1)</script>` lands as inert text, not markup, in an
 * admin- or client-facing email. Left false for plain-text targets (email
 * subject lines, SMS/WhatsApp bodies) where escaping would wrongly show
 * literal "&amp;" etc. to the recipient.
 */
function renderTemplate(template, variables = {}, options = {}) {
  if (typeof template !== 'string') return '';
  const shouldEscape = options.escapeHtml === true;
  return template.replace(PLACEHOLDER_PATTERN, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key) || variables[key] === undefined || variables[key] === null) {
      return '';
    }
    const value = String(variables[key]);
    return shouldEscape ? escapeHtml(value) : value;
  });
}

module.exports = { renderTemplate };
