const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const { ROLES } = require('../../constants/portal/roles');
const dashboardController = require('../../controllers/portal/dashboard.controller');

router.use(authenticate);

router.get('/super-admin', requireRole(ROLES.SUPER_ADMIN), dashboardController.superAdminDashboard);
router.get('/admin', requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN), dashboardController.adminDashboard);
router.get('/client', requireRole(ROLES.CLIENT), dashboardController.clientDashboard);

module.exports = router;
