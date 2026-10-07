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
function handleUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? `File exceeds the maximum allowed size of ${env.MAX_KYC_FILE_SIZE_MB}MB.` : err.message;
    return res.status(400).json({ success: false, message, code: 'VALIDATION_ERROR' });
  }
  return next(err);
}

module.exports = { kycFileUpload: upload.single('file'), handleUploadErrors };
