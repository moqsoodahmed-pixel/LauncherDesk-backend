const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const { requireAnyPermission } = require('../../middleware/portal/requirePermission');
const validateRequest = require('../../middleware/portal/validateRequest');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const notificationsController = require('../../controllers/portal/notifications.controller');
const { listNotificationsValidator, notificationIdParamValidator } = require('../../validators/portal/notifications.validators');

/**
 * Every route here is implicitly scoped to `req.user` ONLY - there is no
 * `:userId` path param anywhere, so there is no arbitrary-recipient
 * surface to even attempt to exploit. Internal users and Clients share
 * this router; the existing VIEW_NOTIFICATIONS/VIEW_OWN_NOTIFICATIONS
 * permissions (both already granted by default - Admin via
 * DEFAULT_ADMIN_PERMISSIONS, Client via CLIENT_PERMISSIONS) gate access,
 * reused rather than duplicated.
 */
router.use(authenticate, requireAnyPermission(PERMISSIONS.VIEW_NOTIFICATIONS, PERMISSIONS.VIEW_OWN_NOTIFICATIONS));

router.get('/', listNotificationsValidator, validateRequest, notificationsController.list);
router.get('/unread-count', notificationsController.unreadCount);
router.patch('/read-all', notificationsController.markAllRead);
router.patch('/archive-read', notificationsController.archiveAll);
router.patch('/:id/read', notificationIdParamValidator, validateRequest, notificationsController.markRead);
router.patch('/:id/archive', notificationIdParamValidator, validateRequest, notificationsController.archive);

module.exports = router;
