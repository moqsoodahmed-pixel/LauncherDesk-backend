const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/admins', require('./admins.routes'));
router.use('/clients', require('./clients.routes'));
router.use('/client', require('./clientProfile.routes'));
router.use('/client/orders', require('./clientOrders.routes'));
router.use('/services', require('./services.routes'));
router.use('/orders', require('./orders.routes'));
router.use('/payments', require('./payments.routes'));
router.use('/kyc', require('./kyc.routes'));
router.use('/invoices', require('./invoices.routes'));
router.use('/documents', require('./documents.routes'));
router.use('/notifications', require('./notifications.routes'));
router.use('/communications', require('./communications.routes'));
router.use('/audit-logs', require('./auditLogs.routes'));
router.use('/dashboard', require('./dashboard.routes'));
router.use('/reports', require('./reports.routes'));
router.use('/settings', require('./settings.routes'));
router.use('/tasks', require('./tasks.routes'));
router.use('/support', require('./support.routes'));
router.use('/search', require('./search.routes'));
router.use('/finance', require('./finance.routes'));
router.use('/crm', require('./crm.routes'));
router.use('/attention', require('./attention.routes'));
router.use('/announcements', require('./announcements.routes'));
router.use('/sse', require('./sse.routes'));

router.get('/health', (req, res) => {
  res.json({ success: true, message: 'LauncherDesk API is running.', data: { timestamp: new Date().toISOString() } });
});

router.get('/health/modules', async (req, res) => {
  try {
    const { Order, Payment, Client, KycDocument, User } = require('../../models/portal');
    const [orderCheck, paymentCheck, kycCheck, clientCheck, userCheck] = await Promise.allSettled([
      Order.countDocuments({}).then(n => ({ ok: true, count: n })),
      Payment.countDocuments({}).then(n => ({ ok: true, count: n })),
      KycDocument.countDocuments({}).then(n => ({ ok: true, count: n })),
      Client.countDocuments({}).then(n => ({ ok: true, count: n })),
      User.countDocuments({}).then(n => ({ ok: true, count: n })),
    ]);
    const get = r => r.status === 'fulfilled' ? r.value : { ok: false, count: 0 };
    const orders = get(orderCheck);
    const payments = get(paymentCheck);
    const kyc = get(kycCheck);
    const clients = get(clientCheck);
    const users = get(userCheck);

    const paidOrders = await Order.countDocuments({ paymentStatus: 'PAID' }).catch(() => 0);
    const confirmedPay = await Payment.countDocuments({ status: 'CONFIRMED' }).catch(() => 0);
    const revenueHealthy = !(paidOrders > 0 && confirmedPay === 0);

    res.json({
      success: true,
      message: 'Module health check.',
      data: {
        revenueHealthy,
        allHealthy: users.ok && orders.ok && payments.ok && kyc.ok && clients.ok && revenueHealthy,
        modules: {
          authentication: { label: 'Authentication', status: users.ok ? 'Active' : 'Error', healthy: users.ok },
          orderEngine: { label: 'Order Engine', status: orders.ok ? 'Active' : 'Error', healthy: orders.ok },
          kycProcessing: { label: 'KYC Processing', status: kyc.ok ? 'Active' : 'Error', healthy: kyc.ok },
          paymentGateway: { label: 'Payment Gateway', status: payments.ok ? (revenueHealthy ? 'Active' : 'Warning') : 'Error', healthy: payments.ok, warning: !revenueHealthy ? 'Revenue anomaly detected' : null },
          crmIntelligence: { label: 'CRM Intelligence', status: clients.ok ? 'Active' : 'Error', healthy: clients.ok },
          notificationSystem: { label: 'Notification System', status: 'Active', healthy: true },
          workflowEngine: { label: 'Workflow Engine', status: orders.ok ? 'Active' : 'Error', healthy: orders.ok },
          auditLogging: { label: 'Audit Logging', status: 'Active', healthy: true },
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Module health check failed.', data: null });
  }
});

module.exports = router;
