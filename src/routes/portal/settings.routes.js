const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const requirePermission = require('../../middleware/portal/requirePermission');
const { ROLES } = require('../../constants/portal/roles');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const { getSettings, updateSetting } = require('../../services/portal/settings.service');
const { sendSuccess } = require('../../utils/portal/apiResponse');

router.use(authenticate, requireRole(ROLES.SUPER_ADMIN));

// GET /settings — returns all settings merged with defaults
router.get('/', requirePermission(PERMISSIONS.VIEW_SETTINGS), async (req, res, next) => {
  try {
    const settings = await getSettings();
    return sendSuccess(res, { message: 'Settings.', data: settings });
  } catch (err) {
    next(err);
  }
});

// PUT /settings/:key — update a single setting
router.put('/:key', requirePermission(PERMISSIONS.MANAGE_SETTINGS), async (req, res, next) => {
  try {
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ success: false, message: 'value is required.' });
    }
    const result = await updateSetting(req.params.key, value, req.user);
    return sendSuccess(res, { message: 'Setting updated.', data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
