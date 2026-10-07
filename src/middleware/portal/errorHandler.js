const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');
const { ERROR_CODES } = require('../../constants/portal/errorCodes');

/**
 * Must be registered LAST in app.js (after all routes). Express
 * recognizes error-handling middleware by its 4-argument signature.
 *
 * FIX SEC-003: Never leaks stack traces, raw database errors, or internal
 * paths to the client — in ANY environment. The devStack field has been
 * removed entirely. Full error details are still logged server-side via
 * the logger so developers can debug without exposing internals.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isAppError = err.isOperational === true;

  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : ERROR_CODES.INTERNAL_ERROR;
  const message = isAppError ? err.message : 'An unexpected error occurred.';

  // Always log full error server-side so it is never lost
  if (!isAppError) {
    logger.error('[errorHandler] Unhandled error:', err);
  } else if (statusCode >= 500) {
    logger.error('[errorHandler]', err.message, err.stack);
  }

  const body = { success: false, message, code };

  // Only include structured validation details (safe, no file paths)
  if (isAppError && err.details) {
    body.details = err.details;
  }

  // NOTE: devStack has been intentionally removed.
  // Stack traces expose server file paths, developer usernames, and library
  // internals. They must NEVER be sent to the client — even in development.
  // Use the server logs to debug. (Fixes SEC-003: Stack Traces Exposed in API)

  res.status(statusCode).json(body);
}

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    code: ERROR_CODES.NOT_FOUND,
  });
}

module.exports = { errorHandler, notFoundHandler };