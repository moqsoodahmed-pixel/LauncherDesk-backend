'use strict';

const express = require('express');
const router = express.Router();
const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const { ROLES } = require('../../constants/portal/roles');
const { sendSuccess } = require('../../utils/portal/apiResponse');

router.use(authenticate);
router.use(requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN));

// Universal search across all entity types.
// q: free text — matched against Business IDs, names, codes, emails.
// type: optional filter — client|admin|order|payment|invoice|kyc|ticket|service|task|announcement
// limit: max results per type (default 5)
//
// FIX BUG-SA-09: Added Service model to search index. Previously only admin names
// were indexed; now services, orders (by service name), invoices, client names,
// KYC codes, payments, tasks, and announcements are all searchable.
router.get('/', async (req, res, next) => {
  try {
    const {
      User, Client, Order, Payment, KycDocument,
      SupportTicket, Announcement, Task, Service,
      Invoice, Notification, OrderStatusHistory,
    } = require('../../models/portal');

    const { q = '', type = '', limit = 5 } = req.query;
    const n = Math.max(1, Math.min(20, Number(limit)));

    if (!q.trim()) {
      return sendSuccess(res, { message: 'Search results.', data: { query: q, results: [], total: 0 } });
    }

    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(esc, 'i');

    const results = [];

    async function searchEntities(fn) {
      try { return await fn(); } catch { return []; }
    }

    // ── Services — by serviceCode, name, slug, shortDescription ──────────
    // FIX: Services were completely missing from search. This is the primary
    // fix for BUG-SA-09 (Universal Search Only Finds Admin Names).
    if (!type || type === 'service') {
      const services = await searchEntities(() =>
        Service.find({
          $or: [
            { serviceCode: rx },
            { name: rx },
            { slug: rx },
            { shortDescription: rx },
          ],
        }).select('serviceCode name status category isPublic').limit(n)
      );
      for (const s of services) {
        results.push({
          type: 'service',
          id: s._id,
          code: s.serviceCode,
          label: s.name,
          sub: `${s.category} — ${s.isPublic ? 'Public' : 'Private'}`,
          status: s.status,
          path: `/super-admin/services/${s._id}`,
        });
      }
    }

    // ── Clients — by clientCode, name, email, companyName, phone ─────────
    if (!type || type === 'client') {
      const clients = await searchEntities(() =>
        Client.find({
          $or: [{ clientCode: rx }, { legacyClientCode: rx }, { legacyCode: rx }, { name: rx }, { email: rx }, { companyName: rx }, { phone: rx }],
        }).select('clientCode name email companyName status').limit(n)
      );
      for (const c of clients) {
        results.push({
          type: 'client', id: c._id, code: c.clientCode,
          label: c.name, sub: c.email || c.companyName,
          status: c.status, path: `/super-admin/clients/${c._id}`,
        });
      }
    }

    // ── Admins — by adminCode, name, email ───────────────────────────────
    if (!type || type === 'admin') {
      const admins = await searchEntities(() =>
        User.find({
          role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] },
          $or: [{ adminCode: rx }, { legacyAdminCode: rx }, { legacyCode: rx }, { name: rx }, { email: rx }],
        }).select('adminCode name email role status').limit(n)
      );
      for (const a of admins) {
        results.push({
          type: 'admin', id: a._id, code: a.adminCode,
          label: a.name, sub: a.email,
          status: a.status, path: `/super-admin/admins/${a._id}`,
        });
      }
    }

    // ── Orders — by orderCode, invoiceNumber, or service name snapshot ───
    if (!type || type === 'order') {
      const orders = await searchEntities(() =>
        Order.find({
          $or: [
            { orderCode: rx },
            { legacyOrderCode: rx },
            { legacyCode: rx },
            { invoiceNumber: rx },
            { legacyInvoiceNumber: rx },
            { 'serviceSnapshot.name': rx },
          ],
        })
          .select('orderCode invoiceNumber status paymentStatus serviceSnapshot')
          .populate('client', 'name clientCode')
          .limit(n)
      );
      for (const o of orders) {
        results.push({
          type: 'order', id: o._id, code: o.orderCode,
          label: o.orderCode,
          sub: o.client?.name || o.serviceSnapshot?.name || '—',
          status: o.status, path: `/super-admin/orders/${o._id}`,
        });
        if (o.invoiceNumber && rx.test(o.invoiceNumber)) {
          results.push({
            type: 'invoice', id: o._id, code: o.invoiceNumber,
            label: o.invoiceNumber, sub: `Order: ${o.orderCode}`,
            status: o.status, path: `/super-admin/orders/${o._id}/invoice`,
          });
        }
      }
    }

    // ── Real generated invoices — PortalInvoice model, INV-prefixed numbers.
    // Distinct from the legacy Order.invoiceNumber (LD-prefixed) branch above
    // - Part 3 gap: real invoices generated by invoice.service.js were never
    // searchable at all until now.
    if (!type || type === 'invoice') {
      const invoices = await searchEntities(() =>
        Invoice.find({ invoiceNumber: rx, isCurrentVersion: true })
          .select('invoiceNumber order status')
          .populate('order', 'orderCode')
          .limit(n)
      );
      for (const inv of invoices) {
        results.push({
          type: 'invoice', id: inv._id, code: inv.invoiceNumber,
          label: inv.invoiceNumber, sub: `Order: ${inv.order?.orderCode || '—'}`,
          status: inv.status, path: `/super-admin/invoices/${inv._id}`,
        });
      }
    }

    // ── Notifications — scoped to the requesting user's own inbox only;
    // this is an admin/super-admin search surface, never cross-user. ──────
    if (!type || type === 'notification') {
      const notifications = await searchEntities(() =>
        Notification.find({ recipient: req.user._id, $or: [{ title: rx }, { message: rx }] })
          .select('title message type order createdAt')
          .limit(n)
      );
      for (const note of notifications) {
        results.push({
          type: 'notification', id: note._id, code: note.type,
          label: note.title, sub: note.message,
          status: note.type, path: note.order ? `/super-admin/orders/${note.order}` : `/super-admin/notifications`,
        });
      }
    }

    // ── Timeline / order status history — matched by status name, e.g.
    // searching "KYC" surfaces every order that transitioned through a
    // KYC status. Previously zero coverage anywhere in search. ───────────
    if (!type || type === 'timeline') {
      const history = await searchEntities(() =>
        OrderStatusHistory.find({ $or: [{ toStatus: rx }, { fromStatus: rx }] })
          .select('order fromStatus toStatus createdAt')
          .populate('order', 'orderCode')
          .sort({ createdAt: -1 })
          .limit(n)
      );
      for (const h of history) {
        results.push({
          type: 'timeline', id: h._id, code: h.order?.orderCode || '—',
          label: `${h.fromStatus || 'CREATED'} → ${h.toStatus}`,
          sub: `Order: ${h.order?.orderCode || '—'}`,
          status: h.toStatus, path: h.order ? `/super-admin/orders/${h.order._id}` : `/super-admin/orders`,
        });
      }
    }

    // ── Payments — by paymentCode ─────────────────────────────────────────
    if (!type || type === 'payment') {
      const payments = await searchEntities(() =>
        Payment.find({ $or: [{ paymentCode: rx }, { legacyPaymentCode: rx }, { legacyCode: rx }] })
          .select('paymentCode status amountPaise')
          .populate('order', 'orderCode')
          .limit(n)
      );
      for (const p of payments) {
        results.push({
          type: 'payment', id: p._id, code: p.paymentCode,
          label: p.paymentCode, sub: `Order: ${p.order?.orderCode || '—'}`,
          status: p.status, path: `/super-admin/payments?search=${p.paymentCode}`,
        });
      }
    }

    // ── KYC — by kycCode ─────────────────────────────────────────────────
    if (!type || type === 'kyc') {
      const kycs = await searchEntities(() =>
        KycDocument.find({ $or: [{ kycCode: rx }, { legacyKycCode: rx }, { legacyCode: rx }] })
          .select('kycCode status documentType')
          .populate('order', 'orderCode')
          .limit(n)
      );
      for (const k of kycs) {
        results.push({
          type: 'kyc', id: k._id, code: k.kycCode,
          label: k.kycCode, sub: `${k.documentType} — Order: ${k.order?.orderCode || '—'}`,
          status: k.status, path: `/super-admin/kyc?search=${k.kycCode}`,
        });
      }
    }

    // ── Support Tickets — by ticketCode or subject ───────────────────────
    if (!type || type === 'ticket') {
      const tickets = await searchEntities(() =>
        SupportTicket.find({ $or: [{ ticketCode: rx }, { ticketId: rx }, { legacyTicketCode: rx }, { legacyCode: rx }, { subject: rx }] })
          .select('ticketCode ticketId subject status priority')
          .populate('client', 'name clientCode')
          .limit(n)
      );
      for (const t of tickets) {
        results.push({
          type: 'ticket', id: t._id, code: t.ticketCode || t.ticketId,
          label: t.subject, sub: t.client?.name || '—',
          status: t.status, path: `/super-admin/support?ticket=${t._id}`,
        });
      }
    }

    // ── Announcements — by title or body ─────────────────────────────────
    if (!type || type === 'announcement') {
      const announcements = await searchEntities(() =>
        Announcement.find({ $or: [{ announcementCode: rx }, { title: rx }, { body: rx }] })
          .select('announcementCode title type targetAudience isActive')
          .limit(n)
      );
      for (const a of announcements) {
        results.push({
          type: 'announcement', id: a._id, code: a.announcementCode,
          label: a.title, sub: `${a.type} → ${a.targetAudience}`,
          status: a.isActive ? 'ACTIVE' : 'INACTIVE',
          path: `/super-admin/announcements`,
        });
      }
    }

    // ── Tasks — by taskCode or title ─────────────────────────────────────
    if (!type || type === 'task') {
      const tasks = await searchEntities(() =>
        Task.find({ $or: [{ taskCode: rx }, { title: rx }] })
          .select('taskCode title status priority')
          .populate('order', 'orderCode')
          .limit(n)
      );
      for (const t of tasks) {
        results.push({
          type: 'task', id: t._id, code: t.taskCode,
          label: t.title, sub: `Order: ${t.order?.orderCode || '—'}`,
          status: t.status, path: `/super-admin/workflow?task=${t._id}`,
        });
      }
    }

    return sendSuccess(res, {
      message: 'Search results.',
      data: { query: q, results, total: results.length },
    });
  } catch (err) { next(err); }
});

module.exports = router;