const multer = require('multer');
const env = require('../../config/portal');

/**
 * Memory storage (not disk) - the buffer is needed in-process to compute
 * the checksum and validate the file signature (fileSignature.service.js)
 * before anything is handed to the storage adapter, and is never written
 * to a temp path an attacker could race against.
 *
 * This is a SIZE/field-count ceiling only, enforced before the request
 * body is even fully buffered - the real type/signature validation happens
 * in services/kyc.service.js, which is the actual authority.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_KYC_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
  },
});

// Normalizes Multer's own errors (e.g. LIMIT_FILE_SIZE) into the app's
// standard error response shape instead of letting them fall through to
// the generic error handler as an unoperational 500.
//
// File-security pipeline fix: a MulterError is not the only way this stage
// can fail - a genuinely malformed multipart body (bad/missing boundary,
// a truncated stream, an unexpected Content-Type) throws a plain Error from
// busboy/multer's own parser, which is NOT an instanceof MulterError. That
// error used to fall through to `next(err)` and, since it carries no
// `isOperational`/`statusCode`, surfaced as an opaque 500 "unexpected
// error occurred" - live-tested and confirmed before this fix. Since this
// middleware's only job is parsing the upload body, ANY error reaching it
// is inherently a client-payload problem, never an internal server fault -
// so every error here now gets the same clean 400, not just MulterError.
function handleUploadErrors(err, req, res, next) {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? `File exceeds the maximum allowed size of ${env.MAX_KYC_FILE_SIZE_MB}MB.` : err.message;
    return res.status(400).json({ success: false, message, code: 'VALIDATION_ERROR' });
  }
  return res.status(400).json({
    success: false,
    message: 'The uploaded file could not be read. Please check the file and try again.',
    code: 'VALIDATION_ERROR',
  });
}

module.exports = { kycFileUpload: upload.single('file'), handleUploadErrors };
