const { verifyAccessToken } = require('../../services/portal/token.service');
const { User } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { USER_STATUS } = require('../../constants/portal/userStatus');

/**
 * Verifies the JWT access token on the Authorization header, loads the
 * current user from the database (so status/role/permission changes take
 * effect immediately rather than waiting for token expiry), and attaches
 * it as req.user. This is the ONLY source of truth for identity - client
 * claims (headers, body fields) about who the user is are never trusted.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw AppError.unauthenticated('Missing or malformed Authorization header.');
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') throw AppError.tokenExpired();
      throw AppError.tokenInvalid();
    }

    const user = await User.findById(decoded.sub);
    if (!user) {
      throw AppError.unauthenticated('User no longer exists.');
    }
    if (user.status !== USER_STATUS.ACTIVE) {
      throw AppError.accountDisabled();
    }
    // Logout-all / password change / disable bump tokenVersion, killing
    // access tokens issued before the event.
    if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      throw AppError.tokenInvalid('Session is no longer valid.');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = authenticate;
