/**
 * Validates a file's actual content against its claimed MIME type using
 * magic-byte signatures - never trusts the browser-supplied Content-Type
 * or the file extension alone. A conservative allowlist: PDF + JPEG + PNG
 * only. Anything else (executables, HTML, SVG, ZIP, ...) is rejected.
 *
 * This is NOT antivirus/malware scanning - it only confirms the file is
 * structurally the format it claims to be. No scanner is integrated in
 * this phase (see docs/architecture.md's Phase 7 section for the honest
 * limitation and how the storage abstraction leaves room for one later).
 */
const SIGNATURES = [
  { mimeType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

const ALLOWED_MIME_TYPES = SIGNATURES.map((s) => s.mimeType);

function matchesSignature(buffer, bytes) {
  if (!buffer || buffer.length < bytes.length) return false;
  return bytes.every((byte, i) => buffer[i] === byte);
}

/** Returns the real MIME type detected from file content, or null if none of the allowed signatures match. */
function detectMimeType(buffer) {
  const match = SIGNATURES.find((s) => matchesSignature(buffer, s.bytes));
  return match ? match.mimeType : null;
}

/**
 * The file is only accepted if its content signature matches one of the
 * allowed types AND (when the client supplied one) that claimed MIME type
 * agrees with the detected one - catching a renamed .exe sent as
 * "application/pdf" just as much as a mismatched Content-Type header.
 */
function validateFileContent(buffer, claimedMimeType) {
  const detected = detectMimeType(buffer);
  if (!detected) {
    return { valid: false, reason: 'File type not supported. Only PDF, JPEG, and PNG are accepted.' };
  }
  if (claimedMimeType && !sameFamily(claimedMimeType, detected)) {
    return { valid: false, reason: 'File content does not match its declared type.' };
  }
  return { valid: true, detectedMimeType: detected };
}

// image/jpg vs image/jpeg browser quirks, etc.
function sameFamily(a, b) {
  const normalize = (m) => (m === 'image/jpg' ? 'image/jpeg' : m);
  return normalize(a) === normalize(b);
}

/**
 * File-security pipeline addition: a minimal, HONEST structural check for
 * PDFs beyond the 4-byte %PDF magic-byte match above. This is NOT a real
 * PDF parser - no PDF-parsing library is a dependency of this project
 * (package.json has `pdfkit`, which only GENERATES PDFs, it cannot read or
 * validate an arbitrary uploaded one, and a new dependency was deliberately
 * not added for this small, scoped check). Instead it scans the raw bytes
 * (as latin1 text, so every byte maps to exactly one character - safe for
 * binary content) for the structural markers every valid PDF must contain:
 *
 *  - `%%EOF`      - the end-of-file marker every PDF (classic or updated/
 *                   linearized) ends with. Missing entirely means the file
 *                   is truncated or not really a PDF past its header.
 *  - `startxref`  - present in both classic (trailer+xref table) and
 *                   modern (cross-reference-stream) PDFs; used as the
 *                   "has a real cross-reference section" signal. A classic
 *                   PDF additionally has the literal word `trailer`.
 *  - `/Encrypt`   - the trailer/xref-stream dictionary key that marks an
 *                   encrypted/password-protected PDF. Its presence is
 *                   rejected outright per the brief (encrypted PDFs must
 *                   never be accepted).
 *
 * Honest limitations (documented per the brief rather than silently
 * assumed away): this does NOT validate the full object graph, does NOT
 * catch a corrupted/truncated object stream that still happens to contain
 * these markers, does NOT detect a polyglot file crafted to also be valid
 * as another format, and does NOT inspect for embedded JavaScript/launch
 * actions. A real PDF-parsing library (e.g. pdf-lib or pdfjs-dist) would be
 * needed for comprehensive structural/security validation - recommended as
 * a future improvement, out of scope for this small, additive check.
 */
function validatePdfStructure(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) {
    return { valid: false, reason: 'The PDF file is too small or malformed to be a valid document.' };
  }

  const text = buffer.toString('latin1');

  if (!text.includes('%%EOF')) {
    return { valid: false, reason: 'The PDF file appears to be truncated or malformed (missing end-of-file marker).' };
  }
  if (!text.includes('startxref') && !/\btrailer\b/.test(text)) {
    return { valid: false, reason: 'The PDF file is missing its cross-reference table and could not be validated.' };
  }
  if (/\/Encrypt\b/.test(text)) {
    return { valid: false, reason: 'Password-protected or encrypted PDF files cannot be accepted. Please upload an unencrypted PDF.' };
  }

  return { valid: true, reason: null };
}

module.exports = { ALLOWED_MIME_TYPES, detectMimeType, validateFileContent, validatePdfStructure };
