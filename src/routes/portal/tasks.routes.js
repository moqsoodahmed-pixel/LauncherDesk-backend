'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../../middleware/portal/authenticate');
const requirePermission = require('../../middleware/portal/requirePermission');
const { PERMISSIONS } = require('../../constants/portal/permissions');
const { sendSuccess } = require('../../utils/portal/apiResponse');
const taskService = require('../../services/portal/task.service');

router.use(authenticate);

// List tasks — filterable by orderId, clientId, status, team, priority
router.get('/', requirePermission(PERMISSIONS.VIEW_TASKS), async (req, res, next) => {
  try {
    const { orderId, clientId, status, team, priority, assignedTo, page = 1, limit = 20, sortBy, sortDir } = req.query;
    const result = await taskService.listTasks({
      orderId, clientId, status, team, priority, assignedTo,
      page: Number(page), limit: Number(limit), sortBy, sortDir,
    });
    return sendSuccess(res, { message: 'Tasks.', data: result });
  } catch (err) { next(err); }
});

// Workflow stats (for dashboard)
router.get('/stats', requirePermission(PERMISSIONS.VIEW_TASKS), async (req, res, next) => {
  try {
    const stats = await taskService.getWorkflowStats();
    return sendSuccess(res, { message: 'Workflow stats.', data: stats });
  } catch (err) { next(err); }
});

// Get single task
router.get('/:id', requirePermission(PERMISSIONS.VIEW_TASKS), async (req, res, next) => {
  try {
    const task = await taskService.getTask(req.params.id);
    return sendSuccess(res, { message: 'Task.', data: task });
  } catch (err) { next(err); }
});

// Create manual task
router.post('/', requirePermission(PERMISSIONS.CREATE_TASK), async (req, res, next) => {
  try {
    const task = await taskService.createTask(req.body, req.user);
    return sendSuccess(res, { statusCode: 201, message: 'Task created.', data: task });
  } catch (err) { next(err); }
});

// Update task (title, description, team, priority, dueDate, notes, assignedTo, status)
router.patch('/:id', requirePermission(PERMISSIONS.MANAGE_TASKS), async (req, res, next) => {
  try {
    const task = await taskService.updateTask(req.params.id, req.body, req.user);
    return sendSuccess(res, { message: 'Task updated.', data: task });
  } catch (err) { next(err); }
});

// Mark task complete
router.patch('/:id/complete', requirePermission(PERMISSIONS.MANAGE_TASKS), async (req, res, next) => {
  try {
    const task = await taskService.completeTask(req.params.id, req.user);
    return sendSuccess(res, { message: 'Task completed.', data: task });
  } catch (err) { next(err); }
});

module.exports = router;
