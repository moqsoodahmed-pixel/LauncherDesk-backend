const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../../config/portal');
const { RefreshToken } = require('../../models/portal');

const JWT_ALGORITHM = 'HS256';

/**
 * Access token payload is deliberately minimal: identity (sub), role and the
 * user's tokenVersion (`tv`, for instant server-side invalidation). Nothing
 * sensitive, no permissions - those are always read fresh from the database.
 */
function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, tv: user.tokenVersion ?? 0 },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES, algorithm: JWT_ALGORITHM }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [JWT_ALGORITHM] });
}

function signRefreshToken(userId, sessionId) {
  return jwt.sign(
    { sub: userId.toString(), sid: sessionId, jti: crypto.randomUUID() },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES, algorithm: JWT_ALGORITHM }
  );
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: [JWT_ALGORITHM] });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function msFromExpiry(expiresIn) {
  // Supports the simple formats used by this project: "15m", "7d", "1h".
  const match = /^(\d+)([smhd])$/.exec(expiresIn);
  if (!match) return 15 * 60 * 1000;
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return parseInt(match[1], 10) * multipliers[match[2]];
}

function refreshTtlMs() {
  return msFromExpiry(env.JWT_REFRESH_EXPIRES);
}

async function persistRefreshToken({ rawToken, userId, sessionId, ipAddress, userAgent }) {
  await RefreshToken.create({
    user: userId,
    sessionId,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + refreshTtlMs()),
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  });
}

/**
 * Starts a new session: issues a refresh token (new sessionId) and persists
 * only its hash. Returns the raw token to set as an httpOnly cookie.
 */
async function issueRefreshToken(user, { ipAddress, userAgent } = {}) {
  const sessionId = crypto.randomUUID();
  const rawToken = signRefreshToken(user._id, sessionId);
  await persistRefreshToken({ rawToken, userId: user._id, sessionId, ipAddress, userAgent });
  return rawToken;
}

class RefreshError extends Error {
  /**
   * reason: INVALID | EXPIRED | REVOKED | REUSED | CONCURRENT
   * userId is set when the token was well-formed enough to identify an owner.
   */
  constructor(reason, userId = null) {
    super(`REFRESH_${reason}`);
    this.reason = reason;
    this.userId = userId;
  }
}

/**
 * Rotates a refresh token: the presented token is revoked and a new one in
 * the same session is issued. Presenting an already-rotated token again is
 * treated as theft: the whole session is revoked - unless it happened within
 * a short grace window, which covers legitimate parallel requests (e.g. two
 * tabs / React StrictMode firing refresh at once).
 *
 * The state flip uses an atomic findOneAndUpdate so two concurrent requests
 * can never both rotate the same token.
 */
async function rotateRefreshToken(rawToken, { ipAddress, userAgent } = {}) {
  let decoded;
  try {
    decoded = verifyRefreshToken(rawToken);
  } catch (err) {
    throw new RefreshError(err.name === 'TokenExpiredError' ? 'EXPIRED' : 'INVALID');
  }

  const tokenHash = hashToken(rawToken);
  const newRawToken = signRefreshToken(decoded.sub, decoded.sid);
  const newHash = hashToken(newRawToken);

  const rotated = await RefreshToken.findOneAndUpdate(
    { tokenHash, revoked: false, expiresAt: { $gt: new Date() } },
    { $set: { revoked: true, revokedAt: new Date(), replacedByTokenHash: newHash } },
    { new: false }
  );

  if (!rotated) {
    const existing = await RefreshToken.findOne({ tokenHash });
    if (!existing) throw new RefreshError('INVALID');
    if (existing.expiresAt <= new Date()) throw new RefreshError('EXPIRED', existing.user);

    // Revoked token presented again.
    if (existing.replacedByTokenHash) {
      const ageMs = Date.now() - (existing.revokedAt ? existing.revokedAt.getTime() : 0);
      if (ageMs <= env.REFRESH_REUSE_GRACE_SECONDS * 1000) {
        throw new RefreshError('CONCURRENT', existing.user);
      }
      await revokeSession(existing.sessionId);
      throw new RefreshError('REUSED', existing.user);
    }
    throw new RefreshError('REVOKED', existing.user);
  }

  await persistRefreshToken({
    rawToken: newRawToken,
    userId: rotated.user,
    sessionId: rotated.sessionId,
    ipAddress,
    userAgent,
  });

  return { newRawToken, userId: rotated.user.toString() };
}

async function revokeRefreshToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  const stored = await RefreshToken.findOneAndUpdate(
    { tokenHash, revoked: false },
    { $set: { revoked: true, revokedAt: new Date() } }
  );
  return stored ? stored.user : null;
}

/** Looks up the owner of a (possibly already revoked) refresh token. */
async function findRefreshTokenOwner(rawToken) {
  try {
    verifyRefreshToken(rawToken);
  } catch (err) {
    return null;
  }
  const stored = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
  return stored ? stored.user : null;
}

async function revokeSession(sessionId) {
  await RefreshToken.updateMany({ sessionId, revoked: false }, { revoked: true, revokedAt: new Date() });
}

async function revokeAllUserTokens(userId, { exceptSessionId = null } = {}) {
  const filter = { user: userId, revoked: false };
  if (exceptSessionId) filter.sessionId = { $ne: exceptSessionId };
  await RefreshToken.updateMany(filter, { revoked: true, revokedAt: new Date() });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeSession,
  revokeAllUserTokens,
  findRefreshTokenOwner,
  hashToken,
  RefreshError,
};
