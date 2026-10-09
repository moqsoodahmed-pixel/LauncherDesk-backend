const { Notification, User } = require('../../models/portal');
const { ALL_NOTIFICATION_EVENTS, MANDATORY_NOTIFICATION_EVENTS } = require('../../constants/portal/notificationEvents');
const { NOTIFICATION_SEVERITY } = require('../../constants/portal/notificationSeverity');
const { sanitizeMetadata } = require('../../utils/portal/sanitizeMetadata');
const logger = require('../../utils/portal/logger');

/**
 * The ONE entry point every business service calls to create an in-app
 * notification. Never throws - mirrors communication.service.js's
 * dispatchCommunicationEvent() guarantee: a notification failure must
 * never roll back the business operation that triggered it.
 *
 * Idempotent via `idempotencyKey` (unique index on Notification): the same
 * logical notification (type + relatedResourceId + recipient [+ suffix])
 * is never created twice, while two DIFFERENT logical events (e.g. two
 * separate status changes, disambiguated by `idempotencySuffix`) remain
 * distinct.
 *
 * `recipientUserId` must always be a server-resolved User id - every
 * caller in this codebase resolves it from an already-authoritative
 * relationship (order.client's linked User, an assigned admin's own id,
 * etc.), never from client-submitted input. There is no public API that
 * lets a caller pass an arbitrary recipient into this function.
 */
async function createNotification({
  recipientUserId,
  type,
  title,
  message,
  severity = NOTIFICATION_SEVERITY.INFO,
  relatedResourceType = null,
  relatedResourceId = null,
  order = null,
  client = null,
  metadata = {},
  idempotencySuffix = null,
}) {
  try {
    if (!ALL_NOTIFICATION_EVENTS.includes(type)) {
      logger.error(`[notification] Unknown notification type: ${type}`);
      return null;
    }
    if (!recipientUserId) {
      return null;
    }

    if (!MANDATORY_NOTIFICATION_EVENTS.includes(type)) {
      const recipient = await User.findById(recipientUserId).select('notificationPreferences role');
      if (!recipient) return null;
      if (recipient.notificationPreferences?.inAppEnabled === false) {
        return null; // respected, non-mandatory event only
      }
    }

    const idempotencyKey = [type, relatedResourceId || order?._id || client?._id || 'none', recipientUserId, idempotencySuffix]
      .filter(Boolean)
      .join(':');

    const existing = await Notification.findOne({ idempotencyKey });
    if (existing) {
      return existing; // same logical notification already created - no duplicate
    }

    const recipientUser = await User.findById(recipientUserId).select('role');

    let created;
    try {
      created = await Notification.create({
        recipient: recipientUserId,
        recipientRole: recipientUser?.role || null,
        type,
        severity,
        title,
        message,
        relatedResourceType,
        relatedResourceId,
        order: order?._id || null,
        client: client?._id || null,
        metadata: sanitizeMetadata(metadata),
        idempotencyKey,
      });
    } catch (err) {
      if (err.code === 11000) {
        // Lost a create race against a concurrent identical event - the
        // other call's record is the canonical one.
        return await Notification.findOne({ idempotencyKey });
      }
      throw err;
    }

    // Push real-time update via SSE (non-blocking; no-op if user has no active connection)
    try {
      const unreadCount = await Notification.countDocuments({ recipient: recipientUserId, isRead: false });
      const { pushToUser } = require('../routes/sse.routes');
      pushToUser(recipientUserId, 'notification', serializeNotification(created));
      pushToUser(recipientUserId, 'unread_count', { unreadCount });
    } catch { /* SSE push is best-effort */ }

    return created;
  } catch (err) {
    logger.error(`[notification] createNotification failed for ${type}: ${err.message}`);
    return null;
  }
}

/** Fan-out helper for events with more than one recipient (e.g. client + assigned admin). */
async function createNotifications(recipients) {
  const results = [];
  for (const params of recipients) {
    results.push(await createNotification(params));
  }
  return results;
}

async function getNotificationsForUser(userId, { isRead, type, isArchived, page = 1, limit = 20 } = {}) {
  const filter = { recipient: userId };
  if (isRead !== undefined) filter.isRead = isRead === 'true' || isRead === true;
  if (type) filter.type = type;
  // By default exclude archived; pass isArchived=true to see only archived
  if (isArchived === 'true' || isArchived === true) {
    filter.isArchived = true;
  } else {
    filter.isArchived = { $ne: true };
  }

  const [items, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notification.countDocuments(filter),
  ]);

  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

async function getUnreadCount(userId) {
  const unreadCount = await Notification.countDocuments({ recipient: userId, isRead: false });
  return unreadCount;
}

/** Scoped strictly to the authenticated user - a notification id belonging to someone else resolves to null (404), never a leak. */
async function markAsRead(userId, notificationId) {
  return Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true }
  );
}

async function markAllAsRead(userId) {
  const result = await Notification.updateMany({ recipient: userId, isRead: false }, { $set: { isRead: true, readAt: new Date() } });
  return { modifiedCount: result.modifiedCount };
}

async function archiveNotification(userId, notificationId) {
  return Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { $set: { isArchived: true } },
    { new: true }
  );
}

async function archiveAllRead(userId) {
  const result = await Notification.updateMany(
    { recipient: userId, isRead: true, isArchived: { $ne: true } },
    { $set: { isArchived: true } }
  );
  return { modifiedCount: result.modifiedCount };
}

/**
 * Phase 11 addition: marks every unresolved notification of `type` for
 * `orderId` as resolved. Scoped to a specific order AND a specific
 * notification type deliberately - never a blanket update across all
 * notifications for the order (e.g. a resolved KYC_REJECTED notification
 * is a different thing entirely and must never be touched here).
 *
 * Matched on `relatedResourceId` (not the `order` field): notifications
 * fanned out via notifySuperAdmins() (notificationEvents.service.js) -
 * which is how ORDER_PAID_AWAITING_ASSIGNMENT is created - only ever set
 * relatedResourceType/relatedResourceId, never the separate `order` ref
 * field (confirmed by reading every existing notifySuperAdmins call site;
 * none of them pass `order`). Matching on `order` here would silently
 * resolve nothing, which is exactly the bug a live test against real
 * MongoDB data caught during this change.
 */
async function resolveNotificationsForOrder(orderId, type) {
  if (!orderId || !type) return { modifiedCount: 0 };
  const result = await Notification.updateMany(
    { relatedResourceType: 'Order', relatedResourceId: orderId, type, resolved: { $ne: true } },
    { $set: { resolved: true, resolvedAt: new Date() } }
  );
  return { modifiedCount: result.modifiedCount };
}

function serializeNotification(n) {
  return {
    id: n._id,
    type: n.type,
    severity: n.severity,
    title: n.title,
    message: n.message,
    relatedResourceType: n.relatedResourceType,
    relatedResourceId: n.relatedResourceId,
    order: n.order,
    client: n.client,
    isRead: n.isRead,
    isArchived: n.isArchived || false,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

module.exports = {
  createNotification,
  createNotifications,
  getNotificationsForUser,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveNotification,
  archiveAllRead,
  resolveNotificationsForOrder,
  serializeNotification,
};
