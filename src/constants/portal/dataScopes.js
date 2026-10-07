/**
 * Data scope controls WHICH rows of a given resource type a user can see,
 * enforced at the database query level (see middleware/dataScope.js),
 * never by filtering already-fetched results in the frontend.
 */
const DATA_SCOPES = Object.freeze({
  // Client-record visibility
  ONLY_ASSIGNED_CLIENTS: 'ONLY_ASSIGNED_CLIENTS',
  ALL_CLIENTS: 'ALL_CLIENTS',

  // Order-record visibility
  ASSIGNED_ORDERS: 'ASSIGNED_ORDERS',
  ALL_ORDERS: 'ALL_ORDERS',

  // Client accounts: only records belonging to the authenticated client
  OWN_DATA: 'OWN_DATA',

  // Super Admin bypass - sees everything regardless of other scopes
  ALL_DATA: 'ALL_DATA',
});

/**
 * Default data scope for a newly created Admin.
 */
const DEFAULT_ADMIN_DATA_SCOPE = Object.freeze({
  clients: DATA_SCOPES.ONLY_ASSIGNED_CLIENTS,
  orders: DATA_SCOPES.ASSIGNED_ORDERS,
});

module.exports = { DATA_SCOPES, DEFAULT_ADMIN_DATA_SCOPE };
