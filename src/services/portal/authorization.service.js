const { ROLES } = require('../../constants/portal/roles');
const { DATA_SCOPES } = require('../../constants/portal/dataScopes');
const { ALL_PERMISSIONS, CLIENT_PERMISSIONS } = require('../../constants/portal/permissions');

/**
 * Single source of truth for "what is this user allowed to do / see".
 * Middleware, controllers and services call these helpers instead of
 * sprinkling `role === 'SUPER_ADMIN'` checks around the codebase.
 */

function isSuperAdmin(user) {
  return !!user && user.role === ROLES.SUPER_ADMIN;
}

/**
 * Permissions the user effectively holds.
 *  - SUPER_ADMIN: everything.
 *  - CLIENT: the fixed own-data set, regardless of what is stored on the
 *    document (defence in depth - a client can never be elevated by data).
 *  - ADMIN: exactly what has been explicitly assigned.
 */
function effectivePermissions(user) {
  if (!user) return [];
  if (user.role === ROLES.SUPER_ADMIN) return [...ALL_PERMISSIONS];
  if (user.role === ROLES.CLIENT) return [...CLIENT_PERMISSIONS];
  return [...(user.permissions || [])];
}

function hasPermission(user, permission) {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  return effectivePermissions(user).includes(permission);
}

function hasAllPermissions(user, permissions) {
  return permissions.every((p) => hasPermission(user, p));
}

function hasAnyPermission(user, permissions) {
  return permissions.some((p) => hasPermission(user, p));
}

/**
 * Effective data scope per resource, derived from role first so the stored
 * value can never widen a Client's or narrow a Super Admin's access.
 */
function effectiveDataScope(user) {
  if (isSuperAdmin(user)) {
    return { clients: DATA_SCOPES.ALL_DATA, orders: DATA_SCOPES.ALL_DATA };
  }
  if (user.role === ROLES.CLIENT) {
    return { clients: DATA_SCOPES.OWN_DATA, orders: DATA_SCOPES.OWN_DATA };
  }
  return {
    clients: user.dataScope?.clients || DATA_SCOPES.ONLY_ASSIGNED_CLIENTS,
    orders: user.dataScope?.orders || DATA_SCOPES.ASSIGNED_ORDERS,
  };
}

module.exports = {
  isSuperAdmin,
  effectivePermissions,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  effectiveDataScope,
};
