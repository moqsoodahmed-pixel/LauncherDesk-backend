const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { User, PasswordResetToken } = require('../../models/portal');
const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');
const AppError = require('../../utils/portal/AppError');
const {
  comparePassword,
  hashPassword,
  getDummyHash,
  isPasswordStrongEnough,
  PASSWORD_POLICY_MESSAGE,
} = require('./password.service');
const tokenService = require('./token.service');
const { logAudit } = require('./auditLog.service');
const notificationEventsService = require('./notificationEvents.service');
const { effectivePermissions, effectiveDataScope } = require('./authorization.service');
const { getEmailProvider } = require('../../adapters/email');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { USER_STATUS } = require('../../constants/portal/userStatus');

/**
 * The ONLY shape in which a user leaves the auth layer. Whitelist-based so a
 * new sensitive column can never leak by accident.
 */
function serializeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    department: user.department ?? null,
    role: user.role,
    status: user.status,
    permissions: effectivePermissions(user),
    dataScope: effectiveDataScope(user),
    clientProfile: user.clientProfile ?? null,
    lastLogin: user.lastLogin ?? null,
    createdAt: user.createdAt,
  };
}

function auditCtx(user) {
  return user ? { actor: user._id, actorRole: user.role, resourceType: 'User', resourceId: user._id } : {};
}

/**
 * Authenticates by email/password. Every failure that could reveal whether an
 * email is registered returns the same INVALID_CREDENTIALS error.
 */
async function login({ email, password, ipAddress, userAgent }) {
  const normalizedEmail = String(email).toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

  if (!user) {
    // Burn comparable CPU time so timing doesn't reveal unknown emails.
    await comparePassword(password, await getDummyHash());
    await logAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      metadata: { reason: 'UNKNOWN_EMAIL', email: normalizedEmail.slice(0, 254) },
      ipAddress,
      userAgent,
    });
    throw AppError.invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logAudit({
      ...auditCtx(user),
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      metadata: { reason: 'ACCOUNT_LOCKED' },
      ipAddress,
      userAgent,
    });
    throw AppError.tooManyAttempts();
  }

  const passwordMatches = await comparePassword(password, user.passwordHash);

  if (!passwordMatches) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

    // Defensive guards: use safe fallbacks so that if MAX_FAILED_LOGIN_ATTEMPTS or
    // ACCOUNT_LOCK_MINUTES are missing/undefined from env, we never produce an
    // Invalid Date (NaN) that causes Mongoose to throw a CastError on user.save()
    // and return HTTP 500. With the corrected env.js these will always be defined,
    // but the guards make the auth flow crash-proof regardless.
    const maxAttempts = Number.isFinite(env.MAX_FAILED_LOGIN_ATTEMPTS) ? env.MAX_FAILED_LOGIN_ATTEMPTS : 5;
    const lockMinutes = Number.isFinite(env.ACCOUNT_LOCK_MINUTES) ? env.ACCOUNT_LOCK_MINUTES : 30;

    const justLocked = user.failedLoginAttempts >= maxAttempts;
    if (justLocked) {
      user.lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
      user.failedLoginAttempts = 0;
    }
    await user.save();

    await logAudit({
      ...auditCtx(user),
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      metadata: { reason: 'WRONG_PASSWORD' },
      ipAddress,
      userAgent,
    });
    if (justLocked) {
      await logAudit({ ...auditCtx(user), action: AUDIT_ACTIONS.ACCOUNT_LOCKED, ipAddress, userAgent });
    }
    throw AppError.invalidCredentials();
  }

  // Status is checked only AFTER the password is proven, so an attacker
  // cannot probe which emails belong to disabled accounts.
  if (user.status !== USER_STATUS.ACTIVE) {
    await logAudit({
      ...auditCtx(user),
      action: AUDIT_ACTIONS.ACCOUNT_DISABLED,
      metadata: { attemptedLoginWithStatus: user.status },
      ipAddress,
      userAgent,
    });
    throw AppError.accountDisabled();
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLogin = new Date();
  await user.save();

  const accessToken = tokenService.signAccessToken(user);
  const refreshToken = await tokenService.issueRefreshToken(user, { ipAddress, userAgent });

  await logAudit({ ...auditCtx(user), action: AUDIT_ACTIONS.LOGIN_SUCCESS, ipAddress, userAgent });

  return { user, accessToken, refreshToken };
}

/**
 * Exchanges a refresh token for a new access token + rotated refresh token.
 * Throws tokenService.RefreshError on failure (controller maps it to 401).
 */
async function refreshSession(rawToken, { ipAddress, userAgent } = {}) {
  let rotated;
  try {
    rotated = await tokenService.rotateRefreshToken(rawToken, { ipAddress, userAgent });
  } catch (err) {
    if (err instanceof tokenService.RefreshError && err.reason === 'REUSED') {
      await logAudit({
        actor: err.userId,
        action: AUDIT_ACTIONS.TOKEN_REUSE_DETECTED,
        resourceType: 'User',
        resourceId: err.userId,
        ipAddress,
        userAgent,
      });
      await notificationEventsService
        .notifySecurityEvent(err.userId, 'A reused refresh token was detected on your account and the session was revoked for your safety.')
        .catch(() => { });
    }
    throw err;
  }

  const user = await User.findById(rotated.userId);
  if (!user || user.status !== USER_STATUS.ACTIVE) {
    if (user) await tokenService.revokeAllUserTokens(user._id);
    throw new tokenService.RefreshError('REVOKED', rotated.userId);
  }

  await logAudit({ ...auditCtx(user), action: AUDIT_ACTIONS.TOKEN_REFRESH, ipAddress, userAgent });

  return {
    user,
    accessToken: tokenService.signAccessToken(user),
    refreshToken: rotated.newRawToken,
  };
}

/** Revokes the session behind the given refresh token. Safe if token is junk. */
async function logout(rawToken, { ipAddress, userAgent } = {}) {
  if (!rawToken) return;
  const ownerId = await tokenService.findRefreshTokenOwner(rawToken);
  await tokenService.revokeRefreshToken(rawToken);
  if (ownerId) {
    const owner = await User.findById(ownerId);
    await logAudit({ ...auditCtx(owner), action: AUDIT_ACTIONS.LOGOUT, ipAddress, userAgent });
  }
}

/** Revokes every session of the authenticated user, including live access tokens. */
async function logoutAll(user, { ipAddress, userAgent } = {}) {
  await tokenService.revokeAllUserTokens(user._id);
  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
  await logAudit({ ...auditCtx(user), action: AUDIT_ACTIONS.LOGOUT_ALL, ipAddress, userAgent });
}

const PROFILE_EDITABLE_FIELDS = ['name', 'phone'];

async function updateProfile(user, changes, { ipAddress, userAgent } = {}) {
  const applied = {};
  for (const field of PROFILE_EDITABLE_FIELDS) {
    if (changes[field] !== undefined) {
      user[field] = changes[field];
      applied[field] = true;
    }
  }
  await user.save();
  await logAudit({
    ...auditCtx(user),
    action: AUDIT_ACTIONS.PROFILE_UPDATED,
    metadata: { fields: Object.keys(applied) },
    ipAddress,
    userAgent,
  });
  return user;
}

/**
 * Verifies the current password, sets the new one, and invalidates all other
 * sessions (refresh tokens + outstanding access tokens). The caller's own
 * session survives and receives a fresh access token.
 */
async function changePassword(user, { currentPassword, newPassword, currentRefreshToken }, { ipAddress, userAgent } = {}) {
  const withHash = await User.findById(user._id).select('+passwordHash');
  const matches = await comparePassword(currentPassword, withHash.passwordHash);
  if (!matches) {
    throw AppError.badRequest('Current password is incorrect.', [{ field: 'currentPassword', message: 'Current password is incorrect.' }]);
  }
  if (!isPasswordStrongEnough(newPassword)) {
    throw AppError.badRequest(PASSWORD_POLICY_MESSAGE, [{ field: 'newPassword', message: PASSWORD_POLICY_MESSAGE }]);
  }
  if (await comparePassword(newPassword, withHash.passwordHash)) {
    throw AppError.badRequest('New password must be different from the current password.', [
      { field: 'newPassword', message: 'New password must be different from the current password.' },
    ]);
  }

  withHash.passwordHash = await hashPassword(newPassword);
  withHash.passwordChangedAt = new Date();
  withHash.tokenVersion = (withHash.tokenVersion || 0) + 1;
  await withHash.save();

  let keepSessionId = null;
  if (currentRefreshToken) {
    try {
      const decoded = jwt.verify(currentRefreshToken, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
      if (decoded.sub === String(withHash._id)) keepSessionId = decoded.sid;
    } catch (err) {
      keepSessionId = null;
    }
  }
  await tokenService.revokeAllUserTokens(withHash._id, { exceptSessionId: keepSessionId });

  await logAudit({ ...auditCtx(withHash), action: AUDIT_ACTIONS.PASSWORD_CHANGED, ipAddress, userAgent });
  await notificationEventsService.notifyPasswordChanged(withHash).catch(() => { });

  return { accessToken: tokenService.signAccessToken(withHash) };
}

/**
 * Starts a password reset. ALWAYS behaves identically to the caller whether
 * or not the email exists. The raw token is only ever delivered through the
 * email channel; it is returned from this function solely so tests (and the
 * development email provider) can use it - controllers must never echo it.
 */
async function requestPasswordReset({ email, ipAddress, userAgent }) {
  const user = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!user || user.status !== USER_STATUS.ACTIVE) {
    return { resetToken: null };
  }

  await PasswordResetToken.deleteMany({ user: user._id, usedAt: null });

  const resetToken = crypto.randomBytes(32).toString('hex');
  await PasswordResetToken.create({
    user: user._id,
    tokenHash: tokenService.hashToken(resetToken),
    expiresAt: new Date(Date.now() + env.PASSWORD_RESET_EXPIRES_MINUTES * 60 * 1000),
    requestedIp: ipAddress || null,
  });

  await logAudit({ ...auditCtx(user), action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED, ipAddress, userAgent });

  const link = `${env.CLIENT_URL}/reset-password?token=${resetToken}`;
  try {
    await getEmailProvider().send({
      to: user.email,
      subject: 'Reset your LauncherDesk password',
      html: `<p>Use the link below to reset your password. It expires in ${env.PASSWORD_RESET_EXPIRES_MINUTES} minutes.</p><p><a href="${link}">${link}</a></p>`,
      templateKey: 'PASSWORD_RESET',
      relatedResourceType: 'User',
      relatedResourceId: user._id,
    });
  } catch (err) {
    logger.error('[auth] Failed to send password reset email:', err.message);
  }

  if (env.isDevelopment && process.env.NODE_ENV !== 'test') {
    logger.warn(`[DEVELOPMENT ONLY] Password reset link for ${user.email}: ${link}`);
  }

  return { resetToken };
}

async function resetPassword({ token, newPassword, ipAddress, userAgent }) {
  if (!isPasswordStrongEnough(newPassword)) {
    throw AppError.badRequest(PASSWORD_POLICY_MESSAGE, [{ field: 'newPassword', message: PASSWORD_POLICY_MESSAGE }]);
  }

  // Atomic claim: a token can be redeemed exactly once.
  const record = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: tokenService.hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } }
  );
  if (!record) {
    throw AppError.badRequest('This reset link is invalid or has expired.');
  }

  const user = await User.findById(record.user).select('+passwordHash');
  if (!user || user.status !== USER_STATUS.ACTIVE) {
    throw AppError.badRequest('This reset link is invalid or has expired.');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  await tokenService.revokeAllUserTokens(user._id);
  await logAudit({ ...auditCtx(user), action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED, ipAddress, userAgent });
}

module.exports = {
  serializeUser,
  login,
  refreshSession,
  logout,
  logoutAll,
  updateProfile,
  changePassword,
  requestPasswordReset,
  resetPassword,
};