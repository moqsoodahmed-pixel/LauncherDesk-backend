/**
 * Portal startup data backfills — moved verbatim from the standalone Portal's
 * src/server.js so they still run once the merged LauncherDesk server connects to MongoDB.
 * Each step is idempotent and logs (never throws), exactly as before.
 */
const logger = require('../../utils/portal/logger');

// One-time migration: generate adminCode for any staff users that are missing one.
// Safe to run on every startup — skips users that already have a code.
async function backfillAdminCodes() {
  try {
    const { User } = require('../../models/portal');
    const { generateAdminCode } = require('./idGenerator.service');
    const { ROLES } = require('../../constants/portal/roles');
    const missing = await User.find({
      role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] },
      $or: [{ adminCode: null }, { adminCode: { $exists: false } }],
    }).select('_id');
    if (missing.length === 0) return;
    for (const user of missing) {
      const code = await generateAdminCode();
      await User.updateOne({ _id: user._id }, { $set: { adminCode: code } });
    }
    logger.info(`[migration] Backfilled adminCode for ${missing.length} staff user(s).`);
  } catch (err) {
    logger.error('[migration] backfillAdminCodes failed:', err.message);
  }
}

// For PAID orders that have no CONFIRMED Payment record (set via dev manual override),
// create a synthetic CONFIRMED Payment so revenue dashboards show correct totals.
async function backfillPaidOrderPayments() {
  try {
    const { Order, Payment } = require('../../models/portal');
    const { generatePaymentCode } = require('./idGenerator.service');
    const paidOrders = await Order.find({ paymentStatus: 'PAID' }).select('_id client pricing');
    let created = 0;
    for (const order of paidOrders) {
      const exists = await Payment.findOne({ order: order._id, status: 'CONFIRMED' });
      if (!exists) {
        const paymentCode = await generatePaymentCode();
        await Payment.create({
          order: order._id,
          client: order.client,
          paymentCode,
          provider: 'DEVELOPMENT',
          amountPaise: order.pricing?.totalAmountMinor || 0,
          currency: 'INR',
          status: 'CONFIRMED',
          signatureVerified: false,
          captured: true,
          paidAt: new Date(),
          attemptNumber: 1,
          idempotencyKey: `backfill-paid-${order._id}`,
        });
        created++;
      }
    }
    if (created > 0) logger.info(`[migration] Backfilled Payment records for ${created} PAID order(s).`);
  } catch (err) {
    logger.error('[migration] backfillPaidOrderPayments failed:', err.message);
  }
}

async function backfillInvoiceNumbers() {
  try {
    const { Order } = require('../../models/portal');
    const { generateInvoiceNumber } = require('./idGenerator.service');
    const missing = await Order.find({ $or: [{ invoiceNumber: null }, { invoiceNumber: { $exists: false } }] }).select('_id');
    if (missing.length === 0) return;
    for (const order of missing) {
      const inv = await generateInvoiceNumber();
      await Order.updateOne({ _id: order._id }, { $set: { invoiceNumber: inv } });
    }
    logger.info(`[migration] Backfilled invoiceNumber for ${missing.length} order(s).`);
  } catch (err) {
    logger.error('[migration] backfillInvoiceNumbers failed:', err.message);
  }
}

async function backfillClientCodes() {
  try {
    const { Client } = require('../../models/portal');
    const { generateClientCode } = require('./idGenerator.service');
    // Old format: CL-2026-000001 or CL-2026-000002
    const oldClients = await Client.find({ clientCode: /^CL-\d{4}-\d+$/ }).select('_id clientCode');
    if (oldClients.length === 0) return;
    for (const client of oldClients) {
      const newCode = await generateClientCode();
      await Client.updateOne({ _id: client._id }, { $set: { clientCode: newCode } });
    }
    logger.info(`[migration] Normalized clientCode format for ${oldClients.length} client(s).`);
  } catch (err) {
    logger.error('[migration] backfillClientCodes failed:', err.message);
  }
}

async function runPortalStartupMigrations() {
  await backfillAdminCodes();
  await backfillInvoiceNumbers();
  await backfillPaidOrderPayments();
  await backfillClientCodes();
}

module.exports = { runPortalStartupMigrations };
