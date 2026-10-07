const bcrypt = require('bcryptjs');
const env = require('../../config/portal');

// bcrypt only considers the first 72 bytes; cap length so longer inputs are
// rejected instead of silently truncated.
const MAX_PASSWORD_LENGTH = 72;
const MIN_PASSWORD_LENGTH = 8;

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, env.BCRYPT_ROUNDS);
}

async function comparePassword(plainPassword, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
}

/**
 * Password policy for NEW passwords (change / reset). Login deliberately
 * does not apply it, so existing accounts are never locked out by a
 * policy change.
 */
function isPasswordStrongEnough(plainPassword) {
  if (typeof plainPassword !== 'string') return false;
  if (plainPassword.length < MIN_PASSWORD_LENGTH || plainPassword.length > MAX_PASSWORD_LENGTH) return false;
  return /[A-Za-z]/.test(plainPassword) && /\d/.test(plainPassword);
}

const PASSWORD_POLICY_MESSAGE = `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters and include at least one letter and one number.`;

// Hash of a random string, compared against when the email does not exist so
// response time doesn't reveal whether an account is registered.
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('dummy-password-for-timing-0');
  return dummyHashPromise;
}

module.exports = {
  hashPassword,
  comparePassword,
  isPasswordStrongEnough,
  getDummyHash,
  PASSWORD_POLICY_MESSAGE,
  MAX_PASSWORD_LENGTH,
};
