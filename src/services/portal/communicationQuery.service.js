const { CommunicationLog, Order } = require('../../models/portal');
const { buildOrderScopeFilter } = require('../../middleware/portal/dataScope');
const { COMMUNICATION_CHANNEL } = require('../../constants/portal/communicationChannels');

/** Internal shape. Recipient masked, provider credentials never present on this model anyway. */
function maskRecipient(to, channel) {
  if (!to) return null;
  if (channel === COMMUNICATION_CHANNEL.EMAIL) {
    const [local, domain] = to.split('@');
    if (!domain) return '***';
    return `${local.slice(0, 2)}***@${domain}`;
  }
  // Phone - keep only the last 4 digits.
  return `${'*'.repeat(Math.max(0, to.length - 4))}${to.slice(-4)}`;
}

function serializeForInternal(log) {
  return {
    id: log._id,
    channel: log.channel,
    eventType: log.eventType,
    recipient: maskRecipient(log.to, log.channel),
    order: log.order,
    client: log.client,
    provider: log.provider,
    providerMessageId: log.providerMessageId,
    status: log.status,
    attemptCount: log.attemptCount,
    sentAt: log.sentAt,
    failedAt: log.failedAt,
    failureReason: log.failureReason,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
  };
}

/** Client-safe shape: no provider internals, no raw recipient, no failure diagnostics beyond a plain status. */
function serializeForClient(log) {
  return {
    channel: log.channel,
    eventType: log.eventType,
    status: log.status,
    sentAt: log.sentAt,
  };
}

/**
 * Admin/Super Admin listing, scoped exactly like every other order-scoped
 * query in this app - never a parallel scope engine. Every filter here is
 * an explicit named field from the already-validated query (see
 * validators/communications.validators.js), never a raw passthrough.
 */
async function listCommunicationsForUser(user, { order, client, channel, status, event, dateFrom, dateTo, page = 1, limit = 20 } = {}) {
  const orderScopeFilter = buildOrderScopeFilter(user);
  const scopedOrderIds = await Order.find(orderScopeFilter).distinct('_id');

  const filter = { order: { $in: scopedOrderIds } };
  if (order) filter.order = order; // further narrowed to one order, still implicitly scope-checked via the $in list it must also belong to - see below
  if (client) filter.client = client;
  if (channel) filter.channel = channel;
  if (status) filter.status = status;
  if (event) filter.eventType = event;
  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  // If a specific `order` was requested, it must ALSO be one of the
  // scoped ids - otherwise an Admin could bypass scope by just naming an
  // out-of-scope order id directly.
  if (order && !scopedOrderIds.some((id) => String(id) === String(order))) {
    return { items: [], meta: { page, limit, total: 0, totalPages: 1 } };
  }

  const [items, total] = await Promise.all([
    CommunicationLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    CommunicationLog.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeForInternal),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

async function listCommunicationsForOwnOrder(orderId) {
  const items = await CommunicationLog.find({ order: orderId }).sort({ createdAt: -1 }).limit(50);
  return items.map(serializeForClient);
}

module.exports = { listCommunicationsForUser, listCommunicationsForOwnOrder, serializeForInternal, serializeForClient };
