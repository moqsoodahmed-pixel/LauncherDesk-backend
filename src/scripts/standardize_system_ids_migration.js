'use strict';

/**
 * Migration: Standardize all business IDs across LauncherDesk
 *
 * Target formats:
 *   All System IDs:    LD-YYYY-MMDD-####
 *   Support Tickets:   TCK-YYYY-MMDD-####
 *
 * Guarantees:
 *   - Idempotent: Can be run multiple times safely.
 *   - Preserves all MongoDB _id ObjectIds (zero broken relations).
 *   - Backs up old IDs to `legacyCode` and entity-specific legacy fields.
 *   - Sets `portal_counters` atomically so subsequent IDs continue sequentially.
 *   - Synchronizes dual collections (portal_* and root collections).
 */

require('dotenv').config();
const path = require('path');
const mongoose = require(path.resolve(__dirname, '../../node_modules/mongoose'));

function getDailyParts(date = new Date()) {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const mmdd = `${month}${day}`;
  const ymd = `${year}${mmdd}`;
  return { year, month, day, mmdd, ymd };
}

const IS_STANDARD_LD = /^LD-\d{4}-\d{4}-\d{4,}$/;
const IS_STANDARD_TCK = /^TCK-\d{4}-\d{4}-\d{4,}$/;

async function runMigration() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/launcherdesk';
  console.log(`Connecting to MongoDB at ${mongoUri}...`);
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  console.log('--- Starting ID Standardization Migration ---');

  const counters = {
    LD: {},
    TCK: {},
  };

  function allocateSeq(prefix, date) {
    const { year, mmdd, ymd } = getDailyParts(date);
    if (!counters[prefix][ymd]) {
      counters[prefix][ymd] = 0;
    }
    counters[prefix][ymd]++;
    const seqStr = String(counters[prefix][ymd]).padStart(4, '0');
    return { id: `${prefix}-${year}-${mmdd}-${seqStr}`, seq: counters[prefix][ymd], ymd };
  }

  function noteExistingSeq(prefix, idStr, date) {
    const { ymd } = getDailyParts(date);
    const match = idStr.match(/-(\d{4,})$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!counters[prefix][ymd] || counters[prefix][ymd] < num) {
        counters[prefix][ymd] = num;
      }
    }
  }

  // 1. Orders
  console.log('\n[1/8] Processing Orders...');
  const orders = await db.collection('portal_orders').find().sort({ createdAt: 1 }).toArray();
  let ordersUpdated = 0;
  for (const o of orders) {
    const updates = {};
    let currentOrderCode = o.orderCode;
    let currentInvoiceNumber = o.invoiceNumber;

    if (!currentOrderCode || !IS_STANDARD_LD.test(currentOrderCode)) {
      const { id: newCode } = allocateSeq('LD', o.createdAt);
      updates.orderCode = newCode;
      updates.legacyOrderCode = currentOrderCode;
      updates.legacyCode = currentOrderCode;
    } else {
      noteExistingSeq('LD', currentOrderCode, o.createdAt);
    }

    if (!currentInvoiceNumber || !IS_STANDARD_LD.test(currentInvoiceNumber)) {
      const { id: newInv } = allocateSeq('LD', o.createdAt);
      updates.invoiceNumber = newInv;
      updates.legacyInvoiceNumber = currentInvoiceNumber;
    } else {
      noteExistingSeq('LD', currentInvoiceNumber, o.createdAt);
    }

    if (Object.keys(updates).length > 0) {
      await db.collection('portal_orders').updateOne({ _id: o._id }, { $set: updates });
      await db.collection('orders').updateOne({ _id: o._id }, { $set: updates }).catch(() => {});
      ordersUpdated++;
    }
  }
  console.log(`Updated ${ordersUpdated} / ${orders.length} orders.`);

  // 2. Clients
  console.log('\n[2/8] Processing Clients...');
  const clients = await db.collection('portal_clients').find().sort({ createdAt: 1 }).toArray();
  let clientsUpdated = 0;
  const clientCodeMap = {}; // oldCode -> newCode
  for (const c of clients) {
    const updates = {};
    if (!c.clientCode || !IS_STANDARD_LD.test(c.clientCode)) {
      const { id: newCode } = allocateSeq('LD', c.createdAt);
      updates.clientCode = newCode;
      updates.legacyClientCode = c.clientCode;
      updates.legacyCode = c.clientCode;
      clientCodeMap[c.clientCode] = newCode;
    } else {
      noteExistingSeq('LD', c.clientCode, c.createdAt);
    }

    if (Object.keys(updates).length > 0) {
      await db.collection('portal_clients').updateOne({ _id: c._id }, { $set: updates });
      await db.collection('clients').updateOne({ _id: c._id }, { $set: updates }).catch(() => {});
      clientsUpdated++;
    }
  }
  console.log(`Updated ${clientsUpdated} / ${clients.length} clients.`);

  // Update client snapshots in orders to match
  for (const [oldCode, newCode] of Object.entries(clientCodeMap)) {
    await db.collection('portal_orders').updateMany(
      { 'clientSnapshot.clientCode': oldCode },
      { $set: { 'clientSnapshot.clientCode': newCode, 'clientSnapshot.legacyClientCode': oldCode } }
    );
    await db.collection('orders').updateMany(
      { 'clientSnapshot.clientCode': oldCode },
      { $set: { 'clientSnapshot.clientCode': newCode, 'clientSnapshot.legacyClientCode': oldCode } }
    ).catch(() => {});
  }
  // Also sync by order.client ref
  const allOrders = await db.collection('portal_orders').find().toArray();
  for (const o of allOrders) {
    if (o.client) {
      const client = await db.collection('portal_clients').findOne({ _id: o.client });
      if (client && o.clientSnapshot?.clientCode !== client.clientCode) {
        await db.collection('portal_orders').updateOne({ _id: o._id }, { $set: { 'clientSnapshot.clientCode': client.clientCode, 'clientSnapshot.legacyClientCode': o.clientSnapshot?.clientCode } });
        await db.collection('orders').updateOne({ _id: o._id }, { $set: { 'clientSnapshot.clientCode': client.clientCode, 'clientSnapshot.legacyClientCode': o.clientSnapshot?.clientCode } }).catch(() => {});
      }
    }
  }

  // 3. Admins / Staff users
  console.log('\n[3/8] Processing Staff Users...');
  const admins = await db.collection('portal_users').find({ adminCode: { $exists: true, $ne: null } }).sort({ createdAt: 1 }).toArray();
  let adminsUpdated = 0;
  for (const a of admins) {
    const updates = {};
    if (!a.adminCode || !IS_STANDARD_LD.test(a.adminCode)) {
      const { id: newCode } = allocateSeq('LD', a.createdAt);
      updates.adminCode = newCode;
      updates.legacyAdminCode = a.adminCode;
      updates.legacyCode = a.adminCode;
    } else {
      noteExistingSeq('LD', a.adminCode, a.createdAt);
    }

    if (Object.keys(updates).length > 0) {
      await db.collection('portal_users').updateOne({ _id: a._id }, { $set: updates });
      await db.collection('users').updateOne({ _id: a._id }, { $set: updates }).catch(() => {});
      adminsUpdated++;
    }
  }
  console.log(`Updated ${adminsUpdated} / ${admins.length} admins.`);

  // 4. Payments
  console.log('\n[4/8] Processing Payments...');
  const payments = await db.collection('portal_payments').find().sort({ createdAt: 1 }).toArray();
  let paymentsUpdated = 0;
  for (const p of payments) {
    const updates = {};
    if (!p.paymentCode || !IS_STANDARD_LD.test(p.paymentCode)) {
      const { id: newCode } = allocateSeq('LD', p.createdAt);
      updates.paymentCode = newCode;
      updates.legacyPaymentCode = p.paymentCode;
      updates.legacyCode = p.paymentCode;
    } else {
      noteExistingSeq('LD', p.paymentCode, p.createdAt);
    }

    if (Object.keys(updates).length > 0) {
      await db.collection('portal_payments').updateOne({ _id: p._id }, { $set: updates });
      await db.collection('payments').updateOne({ _id: p._id }, { $set: updates }).catch(() => {});
      paymentsUpdated++;
    }
  }
  console.log(`Updated ${paymentsUpdated} / ${payments.length} payments.`);

  // 5. Support Tickets
  console.log('\n[5/8] Processing Support Tickets...');
  const tickets = await db.collection('portal_support_tickets').find().sort({ createdAt: 1 }).toArray();
  let ticketsUpdated = 0;
  for (const t of tickets) {
    const updates = {};
    const code = t.ticketCode || t.ticketId;
    if (!code || !IS_STANDARD_TCK.test(code)) {
      const { id: newCode } = allocateSeq('TCK', t.createdAt);
      updates.ticketCode = newCode;
      updates.ticketId = newCode;
      updates.legacyTicketCode = t.ticketCode || null;
      updates.legacyTicketId = t.ticketId || null;
      updates.legacyCode = code;
    } else {
      noteExistingSeq('TCK', code, t.createdAt);
      if (!t.ticketId) updates.ticketId = code;
      if (!t.ticketCode) updates.ticketCode = code;
    }

    if (Object.keys(updates).length > 0) {
      await db.collection('portal_support_tickets').updateOne({ _id: t._id }, { $set: updates });
      await db.collection('supporttickets').updateOne({ _id: t._id }, { $set: updates }).catch(() => {});
      ticketsUpdated++;
    }
  }
  console.log(`Updated ${ticketsUpdated} / ${tickets.length} tickets.`);

  // 6. KYC Documents
  console.log('\n[6/8] Processing KYC Documents...');
  const kycs = await db.collection('portal_kyc_documents').find().sort({ createdAt: 1 }).toArray();
  let kycsUpdated = 0;
  for (const k of kycs) {
    const updates = {};
    if (!k.kycCode || !IS_STANDARD_LD.test(k.kycCode)) {
      const { id: newCode } = allocateSeq('LD', k.createdAt);
      updates.kycCode = newCode;
      updates.legacyKycCode = k.kycCode;
      updates.legacyCode = k.kycCode;
    } else {
      noteExistingSeq('LD', k.kycCode, k.createdAt);
    }

    if (Object.keys(updates).length > 0) {
      await db.collection('portal_kyc_documents').updateOne({ _id: k._id }, { $set: updates });
      await db.collection('kycdocuments').updateOne({ _id: k._id }, { $set: updates }).catch(() => {});
      kycsUpdated++;
    }
  }
  console.log(`Updated ${kycsUpdated} / ${kycs.length} KYC documents.`);

  // 7. Tasks
  console.log('\n[7/8] Processing Tasks...');
  const tasks = await db.collection('portal_tasks').find().sort({ createdAt: 1 }).toArray();
  let tasksUpdated = 0;
  for (const tk of tasks) {
    const updates = {};
    if (!tk.taskCode || !IS_STANDARD_LD.test(tk.taskCode)) {
      const { id: newCode } = allocateSeq('LD', tk.createdAt);
      updates.taskCode = newCode;
      updates.legacyTaskCode = tk.taskCode;
      updates.legacyCode = tk.taskCode;
    } else {
      noteExistingSeq('LD', tk.taskCode, tk.createdAt);
    }

    if (Object.keys(updates).length > 0) {
      await db.collection('portal_tasks').updateOne({ _id: tk._id }, { $set: updates });
      await db.collection('tasks').updateOne({ _id: tk._id }, { $set: updates }).catch(() => {});
      tasksUpdated++;
    }
  }
  console.log(`Updated ${tasksUpdated} / ${tasks.length} tasks.`);

  // 8. Announcements
  console.log('\n[8/8] Processing Announcements...');
  const anns = await db.collection('portal_announcements').find().sort({ createdAt: 1 }).toArray();
  let annsUpdated = 0;
  for (const an of anns) {
    const updates = {};
    if (!an.announcementCode || !IS_STANDARD_LD.test(an.announcementCode)) {
      const { id: newCode } = allocateSeq('LD', an.createdAt);
      updates.announcementCode = newCode;
      updates.legacyAnnouncementCode = an.announcementCode;
      updates.legacyCode = an.announcementCode;
    } else {
      noteExistingSeq('LD', an.announcementCode, an.createdAt);
    }

    if (Object.keys(updates).length > 0) {
      await db.collection('portal_announcements').updateOne({ _id: an._id }, { $set: updates });
      await db.collection('announcements').updateOne({ _id: an._id }, { $set: updates }).catch(() => {});
      annsUpdated++;
    }
  }
  console.log(`Updated ${annsUpdated} / ${anns.length} announcements.`);

  // 9. Sync portal_counters
  console.log('\n--- Syncing Atomic Counters ---');
  for (const [ymd, seq] of Object.entries(counters.LD)) {
    const counterKey = `daily-LD-${ymd}`;
    await db.collection('portal_counters').updateOne(
      { _id: counterKey },
      { $max: { seq } },
      { upsert: true }
    );
    console.log(`Set ${counterKey} seq >= ${seq}`);
  }
  for (const [ymd, seq] of Object.entries(counters.TCK)) {
    const counterKey = `daily-TCK-${ymd}`;
    await db.collection('portal_counters').updateOne(
      { _id: counterKey },
      { $max: { seq } },
      { upsert: true }
    );
    console.log(`Set ${counterKey} seq >= ${seq}`);
  }

  console.log('\nMigration completed successfully!');
  await mongoose.disconnect();
}

if (require.main === module) {
  runMigration().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { runMigration };
