'use strict';

/**
 * Clean up test/demo accounts and verification records from the database.
 * Run this to ensure only live/legitimate records exist in the database.
 *
 * Usage:
 *   node src/scripts/cleanTestData.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function cleanTestData() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/launcherdesk';
  console.log(`Connecting to MongoDB at ${uri}...`);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  console.log('Cleaning test / demo records from database...\n');

  // 1. Clean test tickets
  const ticketFilter = {
    $or: [
      { subject: { $regex: /Standard ID Verification Ticket|Test Customer Standard Ticket Format/i } },
      { 'messages.body': { $regex: /TCK-YYYY-MMDD-####/i } },
    ],
  };
  const deletedPortalTickets = await db.collection('portal_support_tickets').deleteMany(ticketFilter);
  const deletedLegacyTickets = await db.collection('supporttickets').deleteMany(ticketFilter);
  console.log(`✓ Deleted test support tickets: ${deletedPortalTickets.deletedCount} (portal) + ${deletedLegacyTickets.deletedCount} (legacy)`);

  // 2. Clean simulated test payments
  const payFilter = {
    $or: [
      { razorpayPaymentId: { $regex: /^pay_sim_/i } },
      { providerPaymentId: { $regex: /^pay_sim_/i } },
    ],
  };
  const deletedPayments = await db.collection('payments').deleteMany(payFilter);
  const deletedPortalPayments = await db.collection('portal_payments').deleteMany(payFilter);
  console.log(`✓ Deleted simulated payments: ${deletedPayments.deletedCount} (main) + ${deletedPortalPayments.deletedCount} (portal)`);

  // 3. Clean test orders generated during automated test runs
  const orderFilter = {
    $or: [
      { orderNumber: { $regex: /^LD-2026-1007-014[0-9]/ } },
      { 'notes.serviceTitle': 'Trademark Registration' },
    ],
  };
  const deletedOrders = await db.collection('orders').deleteMany(orderFilter);
  console.log(`✓ Deleted automated test orders: ${deletedOrders.deletedCount}`);

  // 4. Clean test accounts
  const testEmailRegex = /(@launcherdesk\.test$|^test_.*@launcherdesk\.com$|^test[0-9]*@gmail\.com$|^test@example\.com$|^partner_test_.*@testcorp\.com$|^67467647474@com$)/i;

  const testPortalUsers = await db.collection('portal_users').find({ email: { $regex: testEmailRegex } }).toArray();
  const testPortalUserIds = testPortalUsers.map((u) => u._id);
  const testClientProfiles = testPortalUsers.map((u) => u.clientProfile).filter(Boolean);

  if (testPortalUserIds.length > 0) {
    await db.collection('portal_users').deleteMany({ _id: { $in: testPortalUserIds } });
    if (testClientProfiles.length > 0) {
      await db.collection('portal_clients').deleteMany({ _id: { $in: testClientProfiles } });
    }
  }
  console.log(`✓ Deleted test portal users: ${testPortalUsers.length}`);

  const testUsers = await db.collection('users').find({ email: { $regex: testEmailRegex } }).toArray();
  const testUserIds = testUsers.map((u) => u._id);

  if (testUserIds.length > 0) {
    await db.collection('users').deleteMany({ _id: { $in: testUserIds } });
    await db.collection('partners').deleteMany({ userId: { $in: testUserIds } });
  }
  console.log(`✓ Deleted test standard users: ${testUsers.length}`);

  console.log('\n✅ Database test/demo cleanup complete. Only live production records remain.');
  await mongoose.disconnect();
}

cleanTestData().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
