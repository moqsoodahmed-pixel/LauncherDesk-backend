/**
 * Consistent API response shape across the whole backend.
 * Every controller should respond via these helpers rather than
 * calling res.json(...) directly with an ad-hoc shape.
 */

function sendSuccess(res, { statusCode = 200, message = 'Success', data = null, meta = null } = {}) {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
}

function sendError(res, { statusCode = 500, message = 'Something went wrong', code = 'INTERNAL_ERROR', details = null } = {}) {
  const body = { success: false, message, code };
  if (details) body.details = details;
  return res.status(statusCode).json(body);
}

/**
 * Standard response for routes whose underlying feature belongs to a
 * later development phase. Never fake success here.
 */
function sendNotImplemented(res, { feature = 'This feature', phase = null } = {}) {
  return res.status(501).json({
    success: false,
    message: phase ? `${feature} is not implemented yet. Planned for ${phase}.` : `${feature} is not implemented yet.`,
    code: 'FEATURE_NOT_IMPLEMENTED',
  });
}

module.exports = { sendSuccess, sendError, sendNotImplemented };
