/**
 * Migrate data written by the STANDALONE Portal into the merged app's portal_* collections.
 *
 * Why: the standalone Portal used Mongoose default collection names (users, orders,
 * payments, …). Six of those names are also used by LauncherDesk, so the merged app
 * keeps Portal data in its own portal_* collections. Records the standalone Portal
 * created are still in the old collections and must be copied across once.
 *
 * Guarantees
 *   • Copies documents with their ORIGINAL _id → every ref (order.client, user.clientProfile,
 *     payment.order, …) keeps pointing at the right document.
 *   • Insert-if-missing ($setOnInsert): re-running is safe and never overwrites newer data.
 *   • Never deletes or modifies the source collections.
 *   • In collections shared with LauncherDesk, only Portal-shaped documents are copied
 *     (see `filter` below) — LauncherDesk customers, payments, etc. are left alone.
 *
 * Usage
 *   npm run migrate:portal-data -- --dry-run      # report only
 *   npm run migrate:portal-data                   # copy
 *
 *   Source DB defaults to MONGO_URI. If the standalone Portal used a different database,
 *   set PORTAL_SOURCE_MONGODB_URI to it.
 *
 *   KYC files: set PORTAL_SOURCE_STORAGE_PATH to the standalone Portal's LOCAL_STORAGE_PATH
 *   (e.g. ../Launcherdesk-portal/backend/storage). Every file referenced by a KYC record is
 *   copied to PORTAL_LOCAL_STORAGE_PATH under the same storage key; existing files are kept.
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')

const PORTAL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CLIENT']

// source collection (standalone Portal) → target collection (merged app)
const PLAN = [
  // ── names shared with LauncherDesk: copy Portal-shaped documents only ──
  { from: 'users',          to: 'portal_users',          filter: { passwordHash: { $exists: true }, role: { $in: PORTAL_ROLES } } },
  { from: 'payments',       to: 'portal_payments',       filter: { client: { $exists: true }, order: { $exists: true }, razorpayOrderId: { $exists: false } } },
  { from: 'services',       to: 'portal_services',       filter: { serviceCode: { $exists: true } } }, // required in Portal, absent in LauncherDesk
  { from: 'notifications',  to: 'portal_notifications',  filter: { recipient: { $exists: true }, templateId: { $exists: false } } },
  { from: 'supporttickets', to: 'portal_support_tickets', filter: { client: { $exists: true }, customer: { $exists: false } } },
  { from: 'counters',       to: 'portal_counters',       filter: {} }, // LauncherDesk uses ld_counters
  // ── names only the Portal used: copy everything ──
  { from: 'clients',                    to: 'portal_clients' },
  { from: 'orders',                     to: 'portal_orders' },
  { from: 'announcements',              to: 'portal_announcements' },
  { from: 'auditlogs',                  to: 'portal_audit_logs' },
  { from: 'clientassignmenthistories',  to: 'portal_client_assignment_histories' },
  { from: 'docrequests',                to: 'portal_doc_requests' },
  { from: 'communicationlogs',          to: 'portal_email_logs' },
  { from: 'internalnotes',              to: 'portal_internal_notes' },
  { from: 'kycdocuments',               to: 'portal_kyc_documents' },
  { from: 'kycverifications',           to: 'portal_kyc_verifications' },
  { from: 'orderassignmenthistories',   to: 'portal_order_assignment_histories' },
  { from: 'orderstatushistories',       to: 'portal_order_status_histories' },
  { from: 'passwordresettokens',        to: 'portal_password_reset_tokens' },
  { from: 'paymentwebhookevents',       to: 'portal_payment_webhook_events' },
  { from: 'refreshtokens',              to: 'portal_refresh_tokens' },
  { from: 'systemsettings',             to: 'portal_system_settings' },
  { from: 'tasks',                      to: 'portal_tasks' },
]

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const targetUri = process.env.MONGO_URI || 'mongodb://localhost:27017/launcherdesk'
  const sourceUri = process.env.PORTAL_SOURCE_MONGODB_URI || targetUri

  const target = await mongoose.createConnection(targetUri).asPromise()
  const source = sourceUri === targetUri ? target : await mongoose.createConnection(sourceUri).asPromise()
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Portal data migration`)
  console.log(`  source: ${source.name}   target: ${target.name}\n`)

  const existing = new Set((await source.db.listCollections().toArray()).map(c => c.name))
  let copied = 0, skipped = 0, conflicts = 0

  for (const step of PLAN) {
    if (!existing.has(step.from)) continue
    const docs = await source.db.collection(step.from).find(step.filter || {}).toArray()
    if (!docs.length) continue
    const dest = target.db.collection(step.to)
    let stepCopied = 0, stepSkipped = 0, stepConflicts = 0

    for (const doc of docs) {
      // Sequence counters: keep the HIGHER value so newly generated codes can never repeat
      // a code that already exists on either side.
      if (step.to === 'portal_counters') {
        const cur = await dest.findOne({ _id: doc._id })
        if (cur && cur.seq >= doc.seq) { stepSkipped++; continue }
        if (!dryRun) await dest.updateOne({ _id: doc._id }, { $max: { seq: doc.seq } }, { upsert: true })
        stepCopied++; continue
      }
      if (await dest.findOne({ _id: doc._id }, { projection: { _id: 1 } })) { stepSkipped++; continue }
      // A unique email already present under a different _id would break the unique index.
      if (step.to === 'portal_users' && await dest.findOne({ email: doc.email }, { projection: { _id: 1 } })) {
        console.warn(`  ! ${step.to}: ${doc.email} already exists with another _id — left untouched`)
        stepConflicts++; continue
      }
      if (!dryRun) {
        try {
          await dest.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true })
        } catch (err) {
          // A unique business code (orderCode, clientCode, …) already used by a record created
          // in the merged app. Leave both untouched and report it for manual review.
          if (err.code !== 11000 && !/duplicate key/i.test(err.message)) throw err
          console.warn(`  ! ${step.to}: ${doc._id} not copied — duplicate unique key (${err.message.split('dup key')[1]?.trim() || 'see index'})`)
          stepConflicts++; continue
        }
      } else {
        // Dry run: predict unique-code collisions on the usual business keys.
        const keys = ['orderCode', 'clientCode', 'adminCode', 'paymentCode', 'serviceCode', 'ticketCode', 'invoiceNumber']
          .filter(k => doc[k] != null).map(k => ({ [k]: doc[k] }))
        if (keys.length && await dest.findOne({ $or: keys }, { projection: { _id: 1 } })) {
          console.warn(`  ! ${step.to}: ${doc._id} would collide on a business code (${keys.map(k => Object.values(k)[0]).join(', ')})`)
          stepConflicts++; continue
        }
      }
      stepCopied++
    }
    console.log(`  ${step.from.padEnd(26)} → ${step.to.padEnd(36)} ${dryRun ? 'would copy' : 'copied'} ${stepCopied}, already present ${stepSkipped}${stepConflicts ? `, conflicts ${stepConflicts}` : ''}`)
    copied += stepCopied; skipped += stepSkipped; conflicts += stepConflicts
  }

  // ── KYC files referenced by the migrated records ──
  if (process.env.PORTAL_SOURCE_STORAGE_PATH && existing.has('kycdocuments')) {
    const srcRoot = path.resolve(process.env.PORTAL_SOURCE_STORAGE_PATH)
    const destRoot = path.resolve(__dirname, '../..', process.env.PORTAL_LOCAL_STORAGE_PATH || './private_uploads/portal_kyc')
    let fCopied = 0, fPresent = 0, fMissing = 0
    for (const kyc of await source.db.collection('kycdocuments').find({ storageKey: { $type: 'string' } }, { projection: { storageKey: 1 } }).toArray()) {
      const from = path.resolve(srcRoot, kyc.storageKey)
      const to = path.resolve(destRoot, kyc.storageKey)
      if (!from.startsWith(srcRoot + path.sep) || !to.startsWith(destRoot + path.sep)) { fMissing++; continue } // never leave the roots
      if (fs.existsSync(to)) { fPresent++; continue }
      if (!fs.existsSync(from)) { console.warn(`  ! KYC file missing in source: ${kyc.storageKey}`); fMissing++; continue }
      if (!dryRun) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to) }
      fCopied++
    }
    console.log(`  KYC files → ${destRoot}: ${dryRun ? 'would copy' : 'copied'} ${fCopied}, already present ${fPresent}, missing ${fMissing}`)
  }

  console.log(`\n${dryRun ? 'Would copy' : 'Copied'} ${copied} document(s); ${skipped} already present; ${conflicts} conflict(s).`)
  console.log('Source collections were not modified.')
  await target.close()
  if (source !== target) await source.close()
}

main().catch(err => { console.error('Migration failed:', err); process.exit(1) })
