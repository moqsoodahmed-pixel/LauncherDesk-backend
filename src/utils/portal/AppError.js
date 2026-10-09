const { ERROR_CODES } = require('../../constants/portal/errorCodes');

/**
 * Throw this (or a subclass) anywhere in controllers/services instead of
 * generic Error so the central error handler can produce a consistent,
 * safe response without leaking internals.
 */
class AppError extends Error {
  constructor(message, { statusCode = 500, code = ERROR_CODES.INTERNAL_ERROR, details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details) {
    return new AppError(message, { statusCode: 400, code: ERROR_CODES.VALIDATION_ERROR, details });
  }

  static unauthenticated(message = 'Authentication required.') {
    return new AppError(message, { statusCode: 401, code: ERROR_CODES.UNAUTHENTICATED });
  }

  static tokenExpired(message = 'Access token expired.') {
    return new AppError(message, { statusCode: 401, code: ERROR_CODES.TOKEN_EXPIRED });
  }

  static tokenInvalid(message = 'Invalid access token.') {
    return new AppError(message, { statusCode: 401, code: ERROR_CODES.TOKEN_INVALID });
  }

  static tooManyAttempts(message = 'Too many attempts. Please try again later.') {
    return new AppError(message, { statusCode: 429, code: ERROR_CODES.RATE_LIMITED });
  }

  static invalidCredentials(message = 'Invalid email or password.') {
    return new AppError(message, { statusCode: 401, code: ERROR_CODES.INVALID_CREDENTIALS });
  }

  static accountDisabled(message = 'This account is not available. Please contact support.') {
    return new AppError(message, { statusCode: 403, code: ERROR_CODES.ACCOUNT_DISABLED });
  }

  static forbidden(message = 'You do not have permission to perform this action.') {
    return new AppError(message, { statusCode: 403, code: ERROR_CODES.PERMISSION_DENIED });
  }

  static dataScopeDenied(message = 'You do not have access to this resource.') {
    return new AppError(message, { statusCode: 403, code: ERROR_CODES.DATA_SCOPE_DENIED });
  }

  static notFound(message = 'Resource not found.') {
    return new AppError(message, { statusCode: 404, code: ERROR_CODES.NOT_FOUND });
  }

  static conflict(message = 'Conflicting state.') {
    return new AppError(message, { statusCode: 409, code: ERROR_CODES.CONFLICT });
  }

  static lastSuperAdmin(message = 'This action would remove the last active Super Admin.') {
    return new AppError(message, { statusCode: 409, code: ERROR_CODES.CANNOT_REMOVE_LAST_SUPER_ADMIN });
  }

  static invalidStateTransition(message = 'This status transition is not allowed.') {
    return new AppError(message, { statusCode: 422, code: ERROR_CODES.INVALID_STATE_TRANSITION });
  }

  /** A required dependent service (e.g. the virus scanner) could not be reached. */
  static serviceUnavailable(message = 'This service is temporarily unavailable. Please try again shortly.') {
    return new AppError(message, { statusCode: 503, code: ERROR_CODES.SERVICE_UNAVAILABLE });
  }
}

module.exports = AppError;
