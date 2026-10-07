/**
 * Minimal, dependency-free CSV writer with CSV-formula-injection
 * protection (OWASP): any field value whose first character is one of
 * `= + - @` would be interpreted as a formula by Excel/Sheets when the
 * file is opened, so it is prefixed with a leading tab-safe apostrophe
 * marker to neutralize it. Also quotes any field containing a comma,
 * quote, or newline, doubling embedded quotes per RFC 4180.
 */
const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@'];

function sanitizeCsvField(value) {
  let str = value === null || value === undefined ? '' : String(value);
  if (FORMULA_TRIGGER_CHARS.includes(str[0])) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** `columns`: [{ key, label }]. `rows`: array of plain objects. */
function toCsv(columns, rows) {
  const header = columns.map((c) => sanitizeCsvField(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => sanitizeCsvField(row[c.key])).join(','));
  return [header, ...lines].join('\r\n');
}

/** Safe, non-user-controlled filename - never derived from request input. */
function reportCsvFilename(reportName) {
  const safeName = String(reportName).replace(/[^a-zA-Z0-9_-]/g, '');
  const date = new Date().toISOString().slice(0, 10);
  return `report-${safeName}-${date}.csv`;
}

module.exports = { sanitizeCsvField, toCsv, reportCsvFilename };
