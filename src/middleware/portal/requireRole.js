const AppError = require('../../utils/portal/AppError');

/**
 * Restricts a route to one or more roles. Must run after `authenticate`.
 * Super Admin is NOT implicitly allowed everywhere by this middleware -
 * pass it explicitly when a route should also allow Super Admin.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthenticated());
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(AppError.forbidden());
    }
    next();
  };
}

module.exports = requireRole;
