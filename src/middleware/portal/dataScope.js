const mongoose = require('mongoose');
const { ROLES } = require('../../constants/portal/roles');
const { DATA_SCOPES } = require('../../constants/portal/dataScopes');
const { effectiveDataScope } = require('../../services/portal/authorization.service');
const AppError = require('../../utils/portal/AppError');

/**
 * Data scope controls WHICH rows of a resource a user can reach. It is
 * enforced inside the database query (never by fetching everything and
 * filtering in JS or the frontend).
 *
 * Two reusable building blocks for future Client / Order / KYC modules:
 *   1. scopeClients / scopeOrders  -> req.scopeFilter for LIST queries.
 *   2. loadScoped(Model, ...)      -> loads ONE record by id, with the
 *      scope filter in the same query (IDOR protection).
 *
 * Must run after `authenticate`.
 */

function buildClientScopeFilter(user) {
  const scope = effectiveDataScope(user).clients;

  switch (scope) {
    case DATA_SCOPES.ALL_DATA:
    case DATA_SCOPES.ALL_CLIENTS:
      return {};
    case DATA_SCOPES.OWN_DATA:
      // A client reaches only its own Client profile. No profile -> match nothing.
      return { _id: user.clientProfile || null };
    case DATA_SCOPES.ONLY_ASSIGNED_CLIENTS:
    default:
      return { assignedAdmin: user._id };
  }
}

function buildOrderScopeFilter(user) {
  const scope = effectiveDataScope(user).orders;

  switch (scope) {
    case DATA_SCOPES.ALL_DATA:
    case DATA_SCOPES.ALL_ORDERS:
      return {};
    case DATA_SCOPES.OWN_DATA:
      return { client: user.clientProfile || null };
    case DATA_SCOPES.ASSIGNED_ORDERS:
    default:
      return { assignedAdmin: user._id };
  }
}

// Fails closed: an unknown role never gets an unrestricted filter.
function guardRole(user) {
  if (![ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CLIENT].includes(user.role)) {
    throw AppError.forbidden();
  }
}

function scopeClients(req, res, next) {
  try {
    guardRole(req.user);
    req.scopeFilter = buildClientScopeFilter(req.user);
    next();
  } catch (err) {
    next(err);
  }
}

function scopeOrders(req, res, next) {
  try {
    guardRole(req.user);
    req.scopeFilter = buildOrderScopeFilter(req.user);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * IDOR-safe single-record loader middleware.
 *
 *   router.get('/:id', authenticate, requirePermission(...),
 *     loadScoped(Order, buildOrderScopeFilter), controller);
 *
 * The id from the URL and the user's scope filter go into ONE query, so a
 * record outside the caller's scope is indistinguishable from a record that
 * does not exist: both yield 404 (no existence oracle). The loaded document
 * is attached as req.resource.
 */
function loadScoped(Model, scopeBuilder, { param = 'id', property = 'resource' } = {}) {
  return async (req, res, next) => {
    try {
      const id = req.params[param];
      if (!mongoose.isValidObjectId(id)) {
        return next(AppError.notFound());
      }
      guardRole(req.user);
      const doc = await Model.findOne({ $and: [{ _id: id }, scopeBuilder(req.user)] });
      if (!doc) {
        return next(AppError.notFound());
      }
      req[property] = doc;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  scopeClients,
  scopeOrders,
  buildClientScopeFilter,
  buildOrderScopeFilter,
  loadScoped,
};
