/**
 * Template rendering.
 *   {{name}}   → value, HTML-escaped (safe for customer-supplied text)
 *   {{{name}}} → value inserted as-is (only for HTML the engine builds itself, e.g. document lists)
 * Unknown variables render as an empty string.
 */
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function renderString(tpl, vars, { html = true } = {}) {
  if (!tpl) return ''
  return String(tpl)
    .replace(/\{\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\}/g, (_, k) => (vars[k] ?? ''))
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => (html ? esc(vars[k]) : String(vars[k] ?? '')))
}

const stripHtml = h => String(h || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim()

module.exports = { renderString, stripHtml, esc }
