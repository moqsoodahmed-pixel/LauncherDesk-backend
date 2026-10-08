'use strict';

const { SupportTicket, Client, Order } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { logAudit } = require('./auditLog.service');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { generateTicketCode } = require('./idGenerator.service');
const notificationEventsService = require('./notificationEvents.service');

function serializeTicket(ticket, { includeMessages = true } = {}) {
  const t = ticket.toObject ? ticket.toObject() : ticket;
  const base = {
    id: t._id,
    ticketCode: t.ticketCode,
    clientId: t.client?._id || t.client,
    clientName: t.client?.name || null,
    clientCode: t.client?.clientCode || null,
    orderId: t.order?._id || t.order || null,
    orderCode: t.order?.orderCode || null,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    assignedTo: t.assignedTo ? { id: t.assignedTo._id || t.assignedTo, name: t.assignedTo.name || null } : null,
    messageCount: t.messages?.length || 0,
    lastActivity: t.messages?.length ? t.messages[t.messages.length - 1].createdAt : t.createdAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
  if (includeMessages) {
    base.messages = (t.messages || []).map((m) => ({
      id: m._id,
      body: m.body,
      senderType: m.senderType,
      senderId: m.sender,
      senderName: m.senderName,
      createdAt: m.createdAt,
    }));
  }
  return base;
}

// ── Client-facing ──────────────────────────────────────────────────────────

async function createTicket({ clientId, orderId, subject, body, senderName, actor }) {
  if (orderId) {
    const order = await Order.findOne({ _id: orderId, client: clientId });
    if (!order) throw AppError.forbidden('Order not found or does not belong to you.');
  }

  const ticketCode = await generateTicketCode();
  const ticket = await SupportTicket.create({
    ticketCode,
    client: clientId,
    order: orderId || null,
    subject,
    status: 'OPEN',
    messages: [{ body, senderType: 'CLIENT', sender: actor._id || actor, senderName }],
  });

  await logAudit({
    actor,
    action: AUDIT_ACTIONS.SUPPORT_TICKET_CREATED,
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
    metadata: { ticketCode, subject },
  });

  notificationEventsService
    .notifySupportTicketCreated(ticket, actor._id || actor)
    .catch((err) => console.error('[supportTicket] notifySupportTicketCreated failed', err));

  return serializeTicket(ticket);
}

async function listClientTickets(clientId, { status, page = 1, limit = 20 } = {}) {
  const filter = { client: clientId };
  if (status) filter.status = status;
  const skip = (page - 1) * limit;

  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('order', 'orderCode'),
    SupportTicket.countDocuments(filter),
  ]);

  return { tickets: tickets.map((t) => serializeTicket(t, { includeMessages: false })), total, page, pages: Math.ceil(total / limit) };
}

async function getClientTicket(id, clientId) {
  const ticket = await SupportTicket.findOne({ _id: id, client: clientId }).populate('order', 'orderCode');
  if (!ticket) throw AppError.notFound('Ticket not found.');
  return serializeTicket(ticket);
}

async function addClientReply(id, clientId, { body, senderName, actor }) {
  const ticket = await SupportTicket.findOne({ _id: id, client: clientId });
  if (!ticket) throw AppError.notFound('Ticket not found.');
  if (ticket.status === 'CLOSED') throw AppError.conflict('This ticket is closed.');

  ticket.messages.push({ body, senderType: 'CLIENT', sender: actor._id || actor, senderName });
  ticket.status = 'OPEN';
  await ticket.save();
  return serializeTicket(ticket);
}

// ── Admin-facing ───────────────────────────────────────────────────────────

async function listAllTickets({ status, priority, clientId, search, assignedTo, page = 1, limit = 20 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (clientId) filter.client = clientId;
  if (assignedTo === 'unassigned') filter.assignedTo = null;
  else if (assignedTo) filter.assignedTo = assignedTo;
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ ticketCode: rx }, { ticketId: rx }, { legacyTicketCode: rx }, { legacyCode: rx }, { subject: rx }];
  }
  const skip = (page - 1) * limit;

  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('client', 'name clientCode')
      .populate('order', 'orderCode')
      .populate('assignedTo', 'name adminCode'),
    SupportTicket.countDocuments(filter),
  ]);

  return { tickets: tickets.map((t) => serializeTicket(t, { includeMessages: false })), total, page, pages: Math.ceil(total / limit) };
}

async function getAdminTicket(id) {
  const ticket = await SupportTicket.findById(id)
    .populate('client', 'name clientCode')
    .populate('order', 'orderCode')
    .populate('assignedTo', 'name adminCode');
  if (!ticket) throw AppError.notFound('Ticket not found.');
  return serializeTicket(ticket);
}

async function addAdminReply(id, { body, senderName, actor }) {
  const ticket = await SupportTicket.findById(id);
  if (!ticket) throw AppError.notFound('Ticket not found.');
  if (ticket.status === 'CLOSED') throw AppError.conflict('This ticket is closed.');

  ticket.messages.push({ body, senderType: 'ADMIN', sender: actor._id || actor, senderName: senderName || actor.name });
  ticket.status = 'WAITING';
  await ticket.save();

  await logAudit({
    actor,
    action: AUDIT_ACTIONS.SUPPORT_TICKET_REPLIED,
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
    metadata: { ticketCode: ticket.ticketCode },
  });

  return serializeTicket(ticket);
}

async function updateTicketStatus(id, { status, priority, assignedTo, actor }) {
  const ticket = await SupportTicket.findById(id);
  if (!ticket) throw AppError.notFound('Ticket not found.');

  if (status) {
    ticket.status = status;
    if (status === 'RESOLVED' && !ticket.resolvedAt) ticket.resolvedAt = new Date();
    if (status === 'CLOSED') ticket.closedAt = new Date();
  }
  if (priority) ticket.priority = priority;
  if (assignedTo !== undefined) ticket.assignedTo = assignedTo || null;

  await ticket.save();

  await logAudit({
    actor,
    action: AUDIT_ACTIONS.SUPPORT_TICKET_UPDATED,
    resourceType: 'SupportTicket',
    resourceId: ticket._id,
    metadata: { ticketCode: ticket.ticketCode, status, priority },
  });

  return serializeTicket(ticket);
}

async function getTicketStats() {
  const [open, waiting, resolved, total] = await Promise.all([
    SupportTicket.countDocuments({ status: 'OPEN' }),
    SupportTicket.countDocuments({ status: 'WAITING' }),
    SupportTicket.countDocuments({ status: 'RESOLVED' }),
    SupportTicket.countDocuments({}),
  ]);
  return { open, waiting, resolved, total };
}

module.exports = {
  createTicket,
  listClientTickets,
  getClientTicket,
  addClientReply,
  listAllTickets,
  getAdminTicket,
  addAdminReply,
  updateTicketStatus,
  getTicketStats,
};
