'use strict';

const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const { ROLES } = require('../../constants/portal/roles');
const { Order, Client, Payment, KycDocument, AuditLog, SystemSetting } = require('../../models/portal');
const { sendSuccess } = require('../../utils/portal/apiResponse');

router.use(authenticate, requireRole(ROLES.SUPER_ADMIN));

// ── REQUIRES ATTENTION ────────────────────────────────────────────────────────
// Returns a list of business and system items that need human follow-up.
router.get('/', async (req, res, next) => {
  try {
    const now = new Date();

    function daysAgo(n) { const d = new Date(now); d.setDate(d.getDate() - n); return d; }
    function hoursAgo(n) { const d = new Date(now); d.setHours(d.getHours() - n); return d; }

    const [
      paidOrderCount,
      confirmedPaymentCount,
      activeClientCount,
      pendingKycDocs,
      tokenReuseAlerts,
      failedPayments,
      autoBackupSetting,
    ] = await Promise.all([
      Order.countDocuments({ paymentStatus: 'PAID' }),
      Payment.countDocuments({ status: 'CONFIRMED' }),
      Client.countDocuments({ status: 'ACTIVE' }),
      KycDocument.find({ status: { $in: ['UPLOADED', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED'] } })
        .populate('client', 'clientCode name companyName')
        .sort({ updatedAt: -1 })
        .limit(10),
      AuditLog.find({ action: 'TOKEN_REUSE_DETECTED' })
        .sort({ createdAt: -1 })
        .limit(5),
      Payment.find({ status: 'FAILED' })
        .populate({
          path: 'order',
          select: 'orderCode clientSnapshot',
        })
        .populate('client', 'clientCode name')
        .sort({ createdAt: -1 })
        .limit(10),
      SystemSetting.findOne({ key: 'auto_backup_enabled' }),
    ]);

    const revenueAnomaly = paidOrderCount > 0 && confirmedPaymentCount === 0;
    const crmHealthIssue = activeClientCount > 0 && confirmedPaymentCount === 0 && !revenueAnomaly;
    const backupDisabled = !autoBackupSetting || autoBackupSetting.value === false;

    const [stuckCreated, stuckPayment, stuckAssigned, kycRejectedStale, completedUndelivered, slaBreached] = await Promise.all([
      Order.find({ status: 'CREATED', updatedAt: { $lt: daysAgo(2) } })
        .populate('client', 'clientCode name companyName')
        .populate('assignedAdmin', 'name adminCode')
        .sort({ updatedAt: 1 }).limit(50),

      Order.find({ status: 'PAYMENT_PENDING', updatedAt: { $lt: hoursAgo(12) } })
        .populate('client', 'clientCode name companyName')
        .populate('assignedAdmin', 'name adminCode')
        .sort({ updatedAt: 1 }).limit(50),

      Order.find({ status: 'ASSIGNED', updatedAt: { $lt: daysAgo(2) } })
        .populate('client', 'clientCode name companyName')
        .populate('assignedAdmin', 'name adminCode')
        .sort({ updatedAt: 1 }).limit(50),

      Order.find({ status: 'KYC_REJECTED' })
        .populate('client', 'clientCode name companyName')
        .populate('assignedAdmin', 'name adminCode')
        .sort({ updatedAt: -1 }).limit(50),

      Order.find({ status: 'COMPLETED', updatedAt: { $lt: daysAgo(7) } })
        .populate('client', 'clientCode name companyName')
        .populate('assignedAdmin', 'name adminCode')
        .sort({ updatedAt: 1 }).limit(30),

      Order.find({ slaDeadline: { $lt: now }, status: { $nin: ['COMPLETED', 'DELIVERED', 'CLOSED', 'ARCHIVED', 'CANCELLED'] } })
        .populate('client', 'clientCode name companyName')
        .populate('assignedAdmin', 'name adminCode')
        .sort({ slaDeadline: 1 }).limit(50),
    ]);

    function serialize(order, issue, priority, suggested) {
      return {
        id: order._id,
        orderCode: order.orderCode,
        status: order.status,
        clientCode: order.client?.clientCode || null,
        clientName: order.clientSnapshot?.name || order.client?.name || order.client?.companyName || null,
        assignedAdmin: order.assignedAdmin ? { name: order.assignedAdmin.name, code: order.assignedAdmin.adminCode } : null,
        issue,
        priority,
        suggestedAction: suggested,
        elapsedSince: order.updatedAt,
        slaDeadline: order.slaDeadline || null,
        link: `/super-admin/orders/${order._id}`,
      };
    }

    const items = [
      ...(revenueAnomaly ? [{
        id: 'sys-revenue-anomaly',
        orderCode: null,
        status: 'SYSTEM',
        clientCode: null,
        clientName: null,
        assignedAdmin: null,
        issue: 'Revenue Anomaly — PAID orders exist but ₹0 revenue recorded',
        priority: 'CRITICAL',
        suggestedAction: 'PAID orders found with no CONFIRMED payment records. Check payment pipeline integrity.',
        elapsedSince: null,
        slaDeadline: null,
        link: '/super-admin/payments',
      }] : []),
      ...(tokenReuseAlerts.length > 0 ? [{
        id: 'sys-token-reuse',
        orderCode: null,
        status: 'SECURITY',
        clientCode: null,
        clientName: null,
        assignedAdmin: null,
        issue: `Security Alert — ${tokenReuseAlerts.length} Token Reuse Incident(s) Detected`,
        priority: 'CRITICAL',
        suggestedAction: 'A revoked or duplicate refresh token was presented. Review audit logs and verify actor session integrity.',
        elapsedSince: tokenReuseAlerts[0]?.createdAt,
        slaDeadline: null,
        link: '/super-admin/audit-logs?search=TOKEN_REUSE_DETECTED',
      }] : []),
      ...(backupDisabled ? [{
        id: 'sys-backup-disabled',
        orderCode: null,
        status: 'SYSTEM',
        clientCode: null,
        clientName: null,
        assignedAdmin: null,
        issue: 'Disaster Recovery — Automated Backups Disabled',
        priority: 'HIGH',
        suggestedAction: 'Enable scheduled automatic backups in Settings or Backup Management to prevent data loss.',
        elapsedSince: null,
        slaDeadline: null,
        link: '/super-admin/backup',
      }] : []),
      ...(crmHealthIssue ? [{
        id: 'sys-crm-health',
        orderCode: null,
        status: 'SYSTEM',
        clientCode: null,
        clientName: null,
        assignedAdmin: null,
        issue: 'CRM — No Revenue Data. Client LTV cannot be computed.',
        priority: 'HIGH',
        suggestedAction: 'No confirmed payment records exist. CRM segments and LTV are showing zero.',
        elapsedSince: null,
        slaDeadline: null,
        link: '/super-admin/crm',
      }] : []),
      ...pendingKycDocs.map((doc) => ({
        id: doc._id,
        orderCode: null,
        status: doc.status,
        clientCode: doc.client?.clientCode || null,
        clientName: doc.client?.name || null,
        assignedAdmin: null,
        issue: `KYC Compliance — Document ${doc.kycCode || doc.documentType} is ${doc.status}`,
        priority: doc.status === 'REJECTED' ? 'HIGH' : 'MEDIUM',
        suggestedAction: doc.status === 'REJECTED'
          ? 'Contact client to request re-upload of rejected compliance documents.'
          : 'Review client verification documents and verify or request revisions.',
        elapsedSince: doc.updatedAt,
        slaDeadline: null,
        link: `/super-admin/kyc`,
      })),
      ...slaBreached.map((o) => serialize(o, 'SLA Breached', 'CRITICAL', 'Escalate immediately — order has passed SLA deadline')),
      ...kycRejectedStale.map((o) => serialize(o, 'KYC Rejected — Action Required', 'HIGH', 'Contact client to explain rejection and request corrected documents')),
      ...stuckPayment.map((o) => serialize(o, 'Payment Pending Follow-up', 'HIGH', 'Send payment reminder to client')),
      ...stuckAssigned.map((o) => serialize(o, 'Assigned — No Progress', 'MEDIUM', 'Check with assigned admin on status')),
      ...stuckCreated.map((o) => serialize(o, 'Order Not Moved (2d)', 'MEDIUM', 'Request payment from client or confirm order intent')),
      ...completedUndelivered.map((o) => serialize(o, 'Completed — Not Delivered (7d)', 'LOW', 'Prepare and dispatch delivery package to client')),
    ];

    sendSuccess(res, { message: 'Items requiring attention.', data: items });
  } catch (err) { next(err); }
});

// ── SUMMARY COUNT ──────────────────────────────────────────────────────────────
router.get('/count', async (req, res, next) => {
  try {
    const now = new Date();
    function daysAgo(n) { const d = new Date(now); d.setDate(d.getDate() - n); return d; }
    function hoursAgo(n) { const d = new Date(now); d.setHours(d.getHours() - n); return d; }

    const [criticalOrders, highOrders, mediumOrders, paidOrdCount, confPayCount, tokenReuseCount, pendingKycCount, autoBackupSetting] = await Promise.all([
      Order.countDocuments({ slaDeadline: { $lt: now }, status: { $nin: ['COMPLETED', 'DELIVERED', 'CLOSED', 'ARCHIVED', 'CANCELLED'] } }),
      Order.countDocuments({ $or: [{ status: 'KYC_REJECTED' }, { status: 'PAYMENT_PENDING', updatedAt: { $lt: hoursAgo(12) } }] }),
      Order.countDocuments({ $or: [{ status: 'CREATED', updatedAt: { $lt: daysAgo(2) } }, { status: 'ASSIGNED', updatedAt: { $lt: daysAgo(2) } }] }),
      Order.countDocuments({ paymentStatus: 'PAID' }),
      Payment.countDocuments({ status: 'CONFIRMED' }),
      AuditLog.countDocuments({ action: 'TOKEN_REUSE_DETECTED' }),
      KycDocument.countDocuments({ status: { $in: ['UPLOADED', 'SUBMITTED', 'UNDER_REVIEW'] } }),
      SystemSetting.findOne({ key: 'auto_backup_enabled' }),
    ]);

    const hasRevenueAnomaly = paidOrdCount > 0 && confPayCount === 0;
    const backupDisabled = !autoBackupSetting || autoBackupSetting.value === false;

    const critical = criticalOrders + (hasRevenueAnomaly ? 1 : 0) + (tokenReuseCount > 0 ? 1 : 0);
    const high = highOrders + (backupDisabled ? 1 : 0);
    const medium = mediumOrders + pendingKycCount;

    sendSuccess(res, { message: 'Attention count.', data: { critical, high, medium, total: critical + high + medium } });
  } catch (err) { next(err); }
});

module.exports = router;
