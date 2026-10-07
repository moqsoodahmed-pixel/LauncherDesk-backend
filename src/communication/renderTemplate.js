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

function renderTemplate(template, variables = {}) {
  if (typeof template !== 'string') return '';
  return template.replace(PLACEHOLDER_PATTERN, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key) || variables[key] === undefined || variables[key] === null) {
      return '';
    }
    return String(variables[key]);
  });
}

module.exports = { renderTemplate };
