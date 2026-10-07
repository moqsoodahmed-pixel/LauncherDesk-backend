'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const { ROLES } = require('../../constants/portal/roles');
const { sendSuccess } = require('../../utils/portal/apiResponse');
const supportService = require('../../services/portal/supportTicket.service');

router.use(authenticate);

// ── Client routes (must be logged in as CLIENT with a clientProfile) ──────

router.get('/my/tickets', requireRole(ROLES.CLIENT), async (req, res, next) => {
  try {
    const clientId = req.user.clientProfile;
    if (!clientId) return res.status(400).json({ success: false, message: 'No client profile linked.' });
    const { status, page, limit } = req.query;
    const result = await supportService.listClientTickets(clientId, { status, page: Number(page || 1), limit: Number(limit || 20) });
    return sendSuccess(res, { message: 'Tickets.', data: result });
  } catch (err) { next(err); }
});

router.post('/my/tickets', requireRole(ROLES.CLIENT), async (req, res, next) => {
  try {
    const clientId = req.user.clientProfile;
    if (!clientId) return res.status(400).json({ success: false, message: 'No client profile linked.' });
    const { subject, body, orderId } = req.body;
    if (!subject || !body) return res.status(400).json({ success: false, message: 'subject and body are required.' });
    const ticket = await supportService.createTicket({
      clientId,
      orderId: orderId || null,
      subject,
      body,
      senderName: req.user.name,
      actor: req.user,
    });
    return sendSuccess(res, { statusCode: 201, message: 'Ticket created.', data: ticket });
  } catch (err) { next(err); }
});

router.get('/my/tickets/:id', requireRole(ROLES.CLIENT), async (req, res, next) => {
  try {
    const clientId = req.user.clientProfile;
    if (!clientId) return res.status(400).json({ success: false, message: 'No client profile linked.' });
    const ticket = await supportService.getClientTicket(req.params.id, clientId);
    return sendSuccess(res, { message: 'Ticket.', data: ticket });
  } catch (err) { next(err); }
});

router.post('/my/tickets/:id/reply', requireRole(ROLES.CLIENT), async (req, res, next) => {
  try {
    const clientId = req.user.clientProfile;
    if (!clientId) return res.status(400).json({ success: false, message: 'No client profile linked.' });
    const { body } = req.body;
    if (!body) return res.status(400).json({ success: false, message: 'body is required.' });
    const ticket = await supportService.addClientReply(req.params.id, clientId, {
      body,
      senderName: req.user.name,
      actor: req.user,
    });
    return sendSuccess(res, { message: 'Reply sent.', data: ticket });
  } catch (err) { next(err); }
});

// ── Admin / Super-Admin routes ────────────────────────────────────────────

router.get('/admin/tickets', requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { status, priority, clientId, search, assignedTo, page, limit } = req.query;
    const result = await supportService.listAllTickets({ status, priority, clientId, search, assignedTo, page: Number(page || 1), limit: Number(limit || 20) });
    return sendSuccess(res, { message: 'All tickets.', data: result });
  } catch (err) { next(err); }
});

router.get('/admin/tickets/stats', requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const stats = await supportService.getTicketStats();
    return sendSuccess(res, { message: 'Ticket stats.', data: stats });
  } catch (err) { next(err); }
});

router.get('/admin/tickets/:id', requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const ticket = await supportService.getAdminTicket(req.params.id);
    return sendSuccess(res, { message: 'Ticket.', data: ticket });
  } catch (err) { next(err); }
});

router.post('/admin/tickets/:id/reply', requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { body } = req.body;
    if (!body) return res.status(400).json({ success: false, message: 'body is required.' });
    const ticket = await supportService.addAdminReply(req.params.id, {
      body,
      actor: req.user,
    });
    return sendSuccess(res, { message: 'Reply sent.', data: ticket });
  } catch (err) { next(err); }
});

router.patch('/admin/tickets/:id', requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { status, priority, assignedTo } = req.body;
    const ticket = await supportService.updateTicketStatus(req.params.id, { status, priority, assignedTo, actor: req.user });
    return sendSuccess(res, { message: 'Ticket updated.', data: ticket });
  } catch (err) { next(err); }
});

module.exports = router;
