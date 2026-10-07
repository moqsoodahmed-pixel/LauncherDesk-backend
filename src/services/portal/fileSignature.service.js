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

module.exports = { ALLOWED_MIME_TYPES, detectMimeType, validateFileContent };
