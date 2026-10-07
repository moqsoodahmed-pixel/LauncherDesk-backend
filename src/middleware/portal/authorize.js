/**
 * Single import point for the authorization pipeline:
 *
 *   authenticate -> authorizeRole -> authorizePermission -> authorizeDataScope -> controller
 *
 * Each piece lives in its own module; this file only gives them the names
 * used throughout the docs so route files read consistently.
 */
const authenticate = require('./authenticate');
const requireRole = require('./requireRole');
const requirePermission = require('./requirePermission');
const { scopeClients, scopeOrders, loadScoped } = require('./dataScope');

module.exports = {
  authenticate,
  authorizeRole: requireRole,
  authorizePermission: requirePermission,
  authorizeAnyPermission: requirePermission.requireAnyPermission,
  authorizeDataScope: { clients: scopeClients, orders: scopeOrders },
  authorizeOwnedResource: loadScoped,
};
