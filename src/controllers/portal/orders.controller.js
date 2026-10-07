const ordersService = require('../../services/portal/orders.service');
const orderAssignmentService = require('../../services/portal/orderAssignment.service');
const { sendSuccess } = require('../../utils/portal/apiResponse');
const { ROLES } = require('../../constants/portal/roles');
const { ORDER_SOURCE } = require('../../constants/portal/orderSource');

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

function pagination(req) {
  const page = parseInt(req.query.page, 10);
  const limit = parseInt(req.query.limit, 10);
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20,
  };
}

function serializeForRole(order, role) {
  return role === ROLES.CLIENT ? ordersService.serializeOrderForClient(order) : ordersService.serializeOrder(order);
}

async function list(req, res, next) {
  try {
    const { search, status, paymentStatus, client, service, assignedAdmin, source, category, dateFrom, dateTo, sortBy, sortDir } = req.query;
    const result = await ordersService.listOrders(
      req.scopeFilter,
      { search, status, paymentStatus, client, service, assignedAdmin, source, category, dateFrom, dateTo },
      { ...pagination(req), sortBy, sortDir }
    );
    return sendSuccess(res, { message: 'Orders.', data: result.items.map((o) => serializeForRole(o, req.user.role)), meta: result.meta });
  } catch (err) {
    next(err);
  }
}

function sourceForRole(role) {
  if (role === ROLES.SUPER_ADMIN) return ORDER_SOURCE.SUPER_ADMIN;
  if (role === ROLES.ADMIN) return ORDER_SOURCE.ADMIN;
  return ORDER_SOURCE.CLIENT;
}

async function create(req, res, next) {
  try {
    const order = await ordersService.createOrder({
      clientId: req.body.clientId,
      serviceId: req.body.serviceId,
      orderDetails: req.body.orderDetails,
      notes: req.body.notes,
      source: sourceForRole(req.user.role),
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, { statusCode: 201, message: 'Order created.', data: ordersService.serializeOrder(order) });
  } catch (err) {
    next(err);
  }
}

// Client self-service: clientId is NEVER taken from the request - always
// the authenticated Client's own linked profile.
async function createForClient(req, res, next) {
  try {
    if (!req.user.clientProfile) {
      return next(require('../../utils/portal/AppError').badRequest('No client profile is linked to this account yet.'));
    }
    const order = await ordersService.createOrder({
      clientId: req.user.clientProfile,
      serviceId: req.body.serviceId,
      orderDetails: req.body.orderDetails,
      notes: undefined,
      source: ORDER_SOURCE.CLIENT,
      actor: req.user,
      meta: requestMeta(req),
    });
    return sendSuccess(res, { statusCode: 201, message: 'Order created.', data: ordersService.serializeOrderForClient(order) });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    return sendSuccess(res, { message: 'Order.', data: serializeForRole(req.resource, req.user.role) });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const order = await ordersService.updateOrder(req.resource, req.body, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Order updated.', data: ordersService.serializeOrder(order) });
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const order = await ordersService.updateOrderStatus(req.resource, req.body.status, req.user, { reason: req.body.reason, ...requestMeta(req) });
    return sendSuccess(res, { message: 'Order status updated.', data: ordersService.serializeOrder(order) });
  } catch (err) {
    next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const order = await ordersService.cancelOrder(req.resource, req.body.reason, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Order cancelled.', data: ordersService.serializeOrder(order) });
  } catch (err) {
    next(err);
  }
}

async function close(req, res, next) {
  try {
    const order = await ordersService.closeOrder(req.resource, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Order closed.', data: ordersService.serializeOrder(order) });
  } catch (err) {
    next(err);
  }
}

async function devAdvance(req, res, next) {
  try {
    const order = await ordersService.devAdvanceStatus(req.resource, req.body.toStatus, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'DEVELOPMENT ONLY: order status force-advanced.', data: ordersService.serializeOrder(order) });
  } catch (err) {
    next(err);
  }
}

async function updatePaymentStatus(req, res, next) {
  try {
    const order = await ordersService.updatePaymentStatus(req.resource, req.body.paymentStatus, req.user, {
      reason: req.body.reason,
      ...requestMeta(req),
    });
    return sendSuccess(res, { message: 'DEVELOPMENT/TESTING ONLY: payment status updated.', data: ordersService.serializeOrder(order) });
  } catch (err) {
    next(err);
  }
}

async function assign(req, res, next) {
  try {
    const order = await orderAssignmentService.assignOrder({
      order: req.resource,
      adminId: req.body.adminId,
      actor: req.user,
      reason: req.body.reason,
      meta: requestMeta(req),
    });
    return sendSuccess(res, { message: 'Order assigned.', data: ordersService.serializeOrder(order) });
  } catch (err) {
    next(err);
  }
}

const reassign = assign;

async function unassign(req, res, next) {
  try {
    const order = await orderAssignmentService.unassignOrder({ order: req.resource, actor: req.user, meta: requestMeta(req) });
    return sendSuccess(res, { message: 'Order unassigned.', data: ordersService.serializeOrder(order) });
  } catch (err) {
    next(err);
  }
}

async function getStatusHistory(req, res, next) {
  try {
    const result = await ordersService.getOrderStatusHistory(req.resource._id, pagination(req));
    return sendSuccess(res, { message: 'Order status history.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function getClientStatusHistory(req, res, next) {
  try {
    const items = await ordersService.getClientOrderStatusHistory(req.resource._id);
    return sendSuccess(res, { message: 'Order status history.', data: items });
  } catch (err) {
    next(err);
  }
}

async function cancelOwn(req, res, next) {
  try {
    const order = await ordersService.cancelOwnOrder(req.resource, req.body.reason, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Order cancelled.', data: ordersService.serializeOrderForClient(order) });
  } catch (err) {
    next(err);
  }
}

async function getAssignmentHistory(req, res, next) {
  try {
    const result = await orderAssignmentService.getAssignmentHistory(req.resource._id, pagination(req));
    return sendSuccess(res, { message: 'Order assignment history.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function getActivity(req, res, next) {
  try {
    const result = await ordersService.getOrderActivity(req.resource._id, pagination(req));
    return sendSuccess(res, { message: 'Order activity.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  createForClient,
  getById,
  update,
  updateStatus,
  cancel,
  close,
  devAdvance,
  updatePaymentStatus,
  assign,
  reassign,
  unassign,
  getStatusHistory,
  getClientStatusHistory,
  cancelOwn,
  getAssignmentHistory,
  getActivity,
};
