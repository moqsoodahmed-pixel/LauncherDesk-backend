'use strict';

const { Counter } = require('../../models/portal');

/**
 * Standard Corporate ID Generator for LauncherDesk
 *
 * New Standard Format:
 *   LD-YYYY-MMDD-####
 *
 * Support Tickets Format:
 *   TCK-YYYY-MMDD-####
 *
 * Examples:
 *   LD-2026-1006-0001
 *   LD-2026-1006-0002
 *   LD-2026-1006-0016
 *   LD-2026-1109-0048
 *   TCK-2026-1006-0008
 *
 * Where:
 *   LD   = LauncherDesk
 *   TCK  = Support Tickets
 *   YYYY = 4-digit Year
 *   MMDD = 2-digit Month + 2-digit Day
 *   #### = 4-digit zero-padded daily running sequence (atomic)
 *
 * Internal MongoDB _id remains ObjectId for all models. Business codes are
 * the human-readable identifiers displayed in the UI and referenced in
 * communications. Never expose raw ObjectIds to end-users.
 */

function getDailyParts(date = new Date()) {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const mmdd = `${month}${day}`;
  const ymd = `${year}${mmdd}`;
  return { year, month, day, mmdd, ymd };
}

/**
 * Atomic daily sequence generator.
 * Counter document key: `daily-${prefix}-${ymd}` in `portal_counters`.
 * Guarantee: Uniqueness, thread-safety, race-safety under concurrent load.
 */
async function nextDailySequence(prefix = 'LD', date = new Date()) {
  const { year, mmdd, ymd } = getDailyParts(date);
  const counterKey = `daily-${prefix}-${ymd}`;

  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  const seqStr = String(counter.seq).padStart(4, '0');
  return `${prefix}-${year}-${mmdd}-${seqStr}`;
}

async function generateStandardId(prefix = 'LD', date = new Date()) {
  return nextDailySequence(prefix, date);
}

// ── Canonical Generators ───────────────────────────────────────────────────

async function generateOrderCode(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generateOrderNumber(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generateInvoiceNumber(date = new Date()) {
  return generateStandardId('LD', date);
}

// Distinct from generateInvoiceNumber() above (which numbers the ORDER's
// invoiceNumber field, LD-prefixed, assigned at order creation). This is
// the generated TAX INVOICE PDF's own number - INV-prefixed, assigned only
// once a payment actually succeeds and a PDF is produced for it. Same
// atomic/race-safe/never-reused counter mechanism, just its own daily
// sequence (daily-INV-<date>), entirely independent of the LD- counters.
async function generateTaxInvoiceNumber(date = new Date()) {
  return generateStandardId('INV', date);
}

async function generateClientCode(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generateAdminCode(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generatePaymentCode(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generateTicketCode(date = new Date()) {
  return generateStandardId('TCK', date);
}

async function generateTicketId(date = new Date()) {
  return generateStandardId('TCK', date);
}

async function generateKycCode(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generateTaskCode(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generateAnnouncementCode(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generateDocRequestCode(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generateReportCode(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generateFinanceCode(date = new Date()) {
  return generateStandardId('LD', date);
}

async function generateAuditCode(date = new Date()) {
  return generateStandardId('LD', date);
}

module.exports = {
  getDailyParts,
  nextDailySequence,
  generateStandardId,
  generateOrderCode,
  generateOrderNumber,
  generateInvoiceNumber,
  generateTaxInvoiceNumber,
  generateClientCode,
  generateAdminCode,
  generatePaymentCode,
  generateTicketCode,
  generateTicketId,
  generateKycCode,
  generateTaskCode,
  generateAnnouncementCode,
  generateDocRequestCode,
  generateReportCode,
  generateFinanceCode,
  generateAuditCode,
};
