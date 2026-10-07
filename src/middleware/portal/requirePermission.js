const AppError = require('../../utils/portal/AppError');
const { hasAllPermissions, hasAnyPermission } = require('../../services/portal/authorization.service');

/**
 * Restricts a route to users holding ALL of the given permissions.
 * Super Admin handling lives in authorization.service (not here), so this
 * middleware stays free of role special-cases. Run after `authenticate`.
 */
function requirePermission(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthenticated());
    if (!hasAllPermissions(req.user, requiredPermissions)) return next(AppError.forbidden());
    next();
  };
}

/**
 * Restricts a route to users holding AT LEAST ONE of the given permissions,
 * e.g. an admin-domain permission OR the client "own data" equivalent.
 * The data-scope layer still limits WHICH records each of them can reach.
 */
function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthenticated());
    if (!hasAnyPermission(req.user, permissions)) return next(AppError.forbidden());
    next();
  };
}

module.exports = requirePermission;
module.exports.requireAnyPermission = requireAnyPermission;
