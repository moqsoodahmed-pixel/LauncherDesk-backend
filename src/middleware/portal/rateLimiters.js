const rateLimit = require('express-rate-limit');
const env = require('../../config/portal');
const { ERROR_CODES } = require('../../constants/portal/errorCodes');

function makeLimitHandler() {
  return (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      code: ERROR_CODES.RATE_LIMITED,
    });
  };
}

const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeLimitHandler(),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeLimitHandler(),
  skipSuccessfulRequests: true,
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeLimitHandler(),
});

// File-security pipeline addition: a dedicated, tighter limit specifically
// for the KYC document upload endpoint (stacked on TOP of the general
// /api/portal limiter above, same pattern as loginLimiter/
// passwordResetLimiter stacking on top of it for their own routes) - file
// uploads are more expensive (storage write, antivirus scan) than a typical
// JSON request, so they get their own, smaller budget.
const kycUploadLimiter = rateLimit({
  windowMs: env.KYC_UPLOAD_RATE_LIMIT_WINDOW_MS,
  max: env.KYC_UPLOAD_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeLimitHandler(),
});

module.exports = { generalLimiter, loginLimiter, passwordResetLimiter, kycUploadLimiter };
