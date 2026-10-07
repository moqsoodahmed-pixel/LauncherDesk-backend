const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const validateRequest = require('../../middleware/portal/validateRequest');
const { ROLES } = require('../../constants/portal/roles');
const clientsController = require('../../controllers/portal/clients.controller');
const servicesController = require('../../controllers/portal/services.controller');
const { updateOwnProfileValidator } = require('../../validators/portal/clients.validators');
const { Payment, Order } = require('../../models/portal');
const { sendSuccess } = require('../../utils/portal/apiResponse');

/**
 * The CLIENT role's own self-service profile — distinct from
 * /api/clients, which is the internal Admin/Super Admin management
 * surface. A Client reaches only their own linked Client document here;
 * there is no :id in this router at all, so there is nothing to IDOR.
 */
router.use(authenticate, requireRole(ROLES.CLIENT));

router.get('/profile', clientsController.getOwnProfile);
router.patch('/profile', updateOwnProfileValidator, validateRequest, clientsController.updateOwnProfile);

// Service catalogue — ACTIVE + PUBLIC services only, through the safe public
// serializer (services.service.serializePublicService), never the internal shape.
router.get('/services', servicesController.listPublic);
router.get('/services/:id', servicesController.getPublicById);

// ── Payment method display labels ─────────────────────────────────────────────
// FIX BUG-CL-03: "DEVELOPMENT" was shown as-is to clients. Map internal provider
// and method values to human-readable labels.
const PROVIDER_LABELS = {
  RAZORPAY: 'Razorpay',
  DEVELOPMENT: 'Online Payment',
  BANK_TRANSFER: 'Bank Transfer',
  UPI: 'UPI',
  CASH: 'Cash',
};

const METHOD_LABELS = {
  card: 'Credit / Debit Card',
  upi: 'UPI',
  netbanking: 'Net Banking',
  wallet: 'Wallet',
  emi: 'EMI',
  bank_transfer: 'Bank Transfer',
  cash: 'Cash',
};

// ── Payment status display labels ─────────────────────────────────────────────
// FIX BUG-CL-04: "Not configured" was shown for DEVELOPMENT provider payments.
// Map all internal status values to client-friendly labels.
const STATUS_LABELS = {
  CREATED: 'Awaiting Payment',
  PENDING: 'Processing',
  CONFIRMED: 'Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially Refunded',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

function getMethodLabel(provider, method) {
  if (method && METHOD_LABELS[method.toLowerCase()]) {
    return METHOD_LABELS[method.toLowerCase()];
  }
  return PROVIDER_LABELS[provider] || 'Online Payment';
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] || status?.replace(/_/g, ' ') || 'Unknown';
}

// All payments across this client's orders — client-safe serialization only.
// FIX BUG-CL-02: p.amount was read but Payment model stores amountPaise (in paise).
// Fixed to p.amountPaise / 100 to get the rupee amount.
router.get('/payments', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Find all orders belonging to this client
    const orders = await Order.find({ client: req.user.clientProfile })
      .select('_id orderCode serviceSnapshot')
      .lean();

    const orderIds = orders.map((o) => o._id);
    const orderMap = Object.fromEntries(orders.map((o) => [o._id.toString(), o]));

    const [items, total] = await Promise.all([
      Payment.find({ order: { $in: orderIds } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments({ order: { $in: orderIds } }),
    ]);

    const serialized = items.map((p) => {
      const ord = orderMap[p.order?.toString()];

      // FIX BUG-CL-02: amountPaise is stored in paise (smallest unit).
      // Divide by 100 to get rupees. Previously `p.amount` was read which
      // doesn't exist on the Payment model, always returning undefined → 0.
      const amountRupees = typeof p.amountPaise === 'number' ? p.amountPaise / 100 : 0;

      return {
        id: p._id,
        paymentCode: p.paymentCode || null,
        // FIX BUG-CL-02: correct amount in rupees
        amount: amountRupees,
        currency: p.currency || 'INR',
        // FIX BUG-CL-04: map internal status to a human-readable label
        status: p.status || 'UNKNOWN',
        statusLabel: getStatusLabel(p.status),
        // FIX BUG-CL-03: map DEVELOPMENT/RAZORPAY provider + method to display label
        method: getMethodLabel(p.provider, p.method),
        createdAt: p.createdAt,
        paidAt: p.paidAt || null,
        failedAt: p.failedAt || null,
        order: ord
          ? {
            id: ord._id,
            orderCode: ord.orderCode,
            serviceName: ord.serviceSnapshot?.name || null,
          }
          : null,
      };
    });

    // Summary totals for the client dashboard cards
    const totalPaid = serialized
      .filter((p) => p.status === 'CONFIRMED')
      .reduce((sum, p) => sum + p.amount, 0);

    const totalPending = serialized
      .filter((p) => ['CREATED', 'PENDING'].includes(p.status))
      .reduce((sum, p) => sum + p.amount, 0);

    return sendSuccess(res, {
      message: 'Payments.',
      data: serialized,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        summary: {
          totalPaid: +totalPaid.toFixed(2),
          totalPending: +totalPending.toFixed(2),
          totalPayments: total,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;