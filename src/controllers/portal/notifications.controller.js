const notificationService = require('../../services/portal/notification.service');
const AppError = require('../../utils/portal/AppError');
const { sendSuccess } = require('../../utils/portal/apiResponse');
const { Notification } = require('../../models/portal');

async function list(req, res, next) {
  try {
    const result = await notificationService.getNotificationsForUser(req.user._id, req.query);
    return sendSuccess(res, {
      message: 'Notifications.',
      data: result.items.map(notificationService.serializeNotification),
      meta: result.meta,
    });
  } catch (err) {
    next(err);
  }
}

async function unreadCount(req, res, next) {
  try {
    const unreadCount = await notificationService.getUnreadCount(req.user._id);
    return sendSuccess(res, { message: 'Unread count.', data: { unreadCount } });
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    // Scoped to {_id, recipient: req.user._id} inside the service - a
    // notification id belonging to someone else resolves to null here,
    // never updates it, never leaks whether it exists.
    const notification = await notificationService.markAsRead(req.user._id, req.params.id);
    if (!notification) {
      throw AppError.notFound('Notification not found.');
    }
    return sendSuccess(res, { message: 'Notification marked read.', data: notificationService.serializeNotification(notification) });
  } catch (err) {
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    const result = await notificationService.markAllAsRead(req.user._id);
    return sendSuccess(res, { message: 'All notifications marked read.', data: result });
  } catch (err) {
    next(err);
  }
}

async function archive(req, res, next) {
  try {
    const notification = await notificationService.archiveNotification(req.user._id, req.params.id);
    if (!notification) throw AppError.notFound('Notification not found.');
    return sendSuccess(res, { message: 'Notification archived.', data: notificationService.serializeNotification(notification) });
  } catch (err) { next(err); }
}

async function archiveAll(req, res, next) {
  try {
    const result = await notificationService.archiveAllRead(req.user._id);
    return sendSuccess(res, { message: 'All read notifications archived.', data: result });
  } catch (err) { next(err); }
}

async function getUnreadCountController(req, res, next) {
  try {
    const unreadCount = await notificationService.getUnreadCount(req.user._id);
    return sendSuccess(res, { message: 'Unread count.', data: { unreadCount } });
  } catch (err) { next(err); }
}

module.exports = { list, unreadCount: getUnreadCountController, markRead, markAllRead, archive, archiveAll };
