/**
 * System roles.
 * Kept as a flat, extensible list rather than hard-coded role checks
 * scattered through the app. Always import from here.
 */
const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  CLIENT: 'CLIENT',
});

const ALL_ROLES = Object.values(ROLES);

module.exports = { ROLES, ALL_ROLES };
