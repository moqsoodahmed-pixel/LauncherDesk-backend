const { validationResult } = require('express-validator');
const AppError = require('../../utils/portal/AppError');

/**
 * Runs after express-validator chains in a route definition; collects
 * any validation errors into a single consistent 400 response.
 */
function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(
      AppError.badRequest('Validation failed.', errors.array().map((e) => ({ field: e.path, message: e.msg })))
    );
  }
  next();
}

module.exports = validateRequest;
