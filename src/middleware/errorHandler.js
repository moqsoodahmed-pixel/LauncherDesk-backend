/**
 * Wraps async route handlers to forward errors to Express error middleware.
 * Usage: router.post('/path', asyncHandler(async (req, res) => { ... }))
 */
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

class AppError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.statusCode = statusCode
    Error.captureStackTrace(this, this.constructor)
  }
}

module.exports = { asyncHandler, AppError }
