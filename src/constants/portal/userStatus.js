/**
 * Account lifecycle states. Only ACTIVE accounts may authenticate or use
 * an existing session.
 */
const USER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  SUSPENDED: 'SUSPENDED',
  PENDING: 'PENDING',
});

const ALL_USER_STATUSES = Object.values(USER_STATUS);

module.exports = { USER_STATUS, ALL_USER_STATUSES };
