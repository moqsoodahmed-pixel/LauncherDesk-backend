const { sendNotImplemented } = require('../../utils/portal/apiResponse');

/**
 * Factory for a route handler that honestly reports a feature as not
 * yet implemented, instead of faking a successful business operation.
 * Used for routes whose full logic belongs to a later development
 * phase (see docs/phases.md).
 */
function notImplemented(feature, phase) {
  return (req, res) => sendNotImplemented(res, { feature, phase });
}

module.exports = { notImplemented };
