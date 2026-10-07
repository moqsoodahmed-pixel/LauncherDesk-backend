const authService = require('../../services/portal/auth.service');
const { RefreshError } = require('../../services/portal/token.service');
const { sendSuccess, sendError } = require('../../utils/portal/apiResponse');
const env = require('../../config/portal');
const { validatePasswordPolicy } = require('../../services/portal/settings.service');
const AppError = require('../../utils/portal/AppError');

const REFRESH_COOKIE_NAME = 'portal_refresh_token';
const REFRESH_COOKIE_PATH = '/api/portal/auth';

// Matches the refresh token lifetime (JWT_REFRESH_EXPIRES, "<n>d" form).
function refreshCookieMaxAgeMs() {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_REFRESH_EXPIRES);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return parseInt(match[1], 10) * unit;
}

function refreshCookieOptions() {
  return {
    httpOnly: true, // not readable from JavaScript
    secure: env.isProduction,
    // PORTAL_COOKIE_SAMESITE lets a deployment whose frontend and API live on different
    // sites use 'none'. Default is unchanged from the original Portal.
    sameSite: process.env.PORTAL_COOKIE_SAMESITE || (env.isProduction ? 'strict' : 'lax'),
    path: REFRESH_COOKIE_PATH, // only ever sent to the auth endpoints
    maxAge: refreshCookieMaxAgeMs(),
  };
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined });
}

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

async function login(req, res, next) {
  try {
    const { user, accessToken, refreshToken } = await authService.login({
      email: req.body.email,
      password: req.body.password,
      ...requestMeta(req),
    });

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());

    return sendSuccess(res, {
      message: 'Login successful.',
      data: { user: authService.serializeUser(user), accessToken },
    });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!rawToken) {
      return sendError(res, { statusCode: 401, message: 'No refresh token provided.', code: 'UNAUTHENTICATED' });
    }

    const { accessToken, refreshToken } = await authService.refreshSession(rawToken, requestMeta(req));
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
    return sendSuccess(res, { message: 'Token refreshed.', data: { accessToken } });
  } catch (err) {
    if (err instanceof RefreshError) {
      // A CONCURRENT request lost a benign race: another request already
      // rotated the token and set a fresh cookie, so do not clear it.
      if (err.reason !== 'CONCURRENT') clearRefreshCookie(res);
      return sendError(res, { statusCode: 401, message: 'Invalid or expired refresh token.', code: 'TOKEN_INVALID' });
    }
    return next(err);
  }
}

// Works from the refresh cookie alone, so a user whose access token has
// already expired can still log out and have the session revoked.
async function logout(req, res, next) {
  try {
    await authService.logout(req.cookies?.[REFRESH_COOKIE_NAME], requestMeta(req));
    clearRefreshCookie(res);
    return sendSuccess(res, { message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
}

async function logoutAll(req, res, next) {
  try {
    await authService.logoutAll(req.user, requestMeta(req));
    clearRefreshCookie(res);
    return sendSuccess(res, { message: 'All sessions have been logged out.' });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  return sendSuccess(res, { message: 'Current user.', data: authService.serializeUser(req.user) });
}

async function updateProfile(req, res, next) {
  try {
    const user = await authService.updateProfile(req.user, req.body, requestMeta(req));
    return sendSuccess(res, { message: 'Profile updated.', data: authService.serializeUser(user) });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const policyErrors = await validatePasswordPolicy(req.body.newPassword || '');
    if (policyErrors.length > 0) {
      return next(AppError.badRequest(policyErrors[0]));
    }
    const { accessToken } = await authService.changePassword(
      req.user,
      {
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
        currentRefreshToken: req.cookies?.[REFRESH_COOKIE_NAME],
      },
      requestMeta(req)
    );
    return sendSuccess(res, { message: 'Password changed. Other sessions have been signed out.', data: { accessToken } });
  } catch (err) {
    next(err);
  }
}

// Identical response whether or not the email exists. The reset token is
// delivered by email only and is never part of any HTTP response.
async function forgotPassword(req, res, next) {
  try {
    await authService.requestPasswordReset({ email: req.body.email, ...requestMeta(req) });
    return sendSuccess(res, { message: 'If an account exists for that email, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const policyErrors = await validatePasswordPolicy(req.body.newPassword || '');
    if (policyErrors.length > 0) {
      return next(AppError.badRequest(policyErrors[0]));
    }
    await authService.resetPassword({ token: req.body.token, newPassword: req.body.newPassword, ...requestMeta(req) });
    return sendSuccess(res, { message: 'Password has been reset. You can now sign in.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login, refresh, logout, logoutAll, me, updateProfile, changePassword, forgotPassword, resetPassword,
  // Shared with the unified LauncherDesk login (controllers/authController.js) so the
  // refresh cookie is issued identically no matter which endpoint signed the user in.
  REFRESH_COOKIE_NAME, refreshCookieOptions,
};
