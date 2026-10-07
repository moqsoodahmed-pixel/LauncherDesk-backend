/**
 * Seed one login per role so the unified login can be verified end-to-end.
 *
 *   npm run seed:roles
 *
 * Idempotent: an account whose email already exists is left exactly as it is.
 * Portal accounts are created through the Portal's own services (createAdmin /
 * createClient), so codes, permissions, data scopes and audit entries match what the
 * Portal UI would produce. Refuses to run with NODE_ENV=production unless
 * ALLOW_ROLE_SEED=true. Passwords can be overridden with SEED_<ROLE>_PASSWORD.
 */
require('dotenv').config()
const mongoose = require('mongoose')

const pw = (role, fallback) => process.env[`SEED_${role}_PASSWORD`] || fallback

const ACCOUNTS = {
  customer:         { email: 'customer@launcherdesk.test',   password: pw('CUSTOMER', 'Customer@2026'),      name: 'Test Customer' },
  partner:          { email: 'partner@launcherdesk.test',    password: pw('PARTNER', 'Partner@2026'),        name: 'Test Partner Co' },
  sales:            { email: 'sales@launcherdesk.test',      password: pw('SALES', 'Sales@2026'),            name: 'Test Sales Rep' },
  legacyAdmin:      { email: 'opsadmin@launcherdesk.test',   password: pw('LEGACY_ADMIN', 'OpsAdmin@2026'),  name: 'Test Ops Admin' },
  portalSuperAdmin: { email: 'superadmin@launcherdesk.test', password: pw('PORTAL_SUPER_ADMIN', 'SuperAdmin@2026'), name: 'Portal Super Admin' },
  portalAdmin:      { email: 'portaladmin@launcherdesk.test', password: pw('PORTAL_ADMIN', 'PortalAdmin@2026'), name: 'Portal Admin' },
  portalClient:     { email: 'client@launcherdesk.test',     password: pw('PORTAL_CLIENT', 'Client@2026'),   name: 'Portal Client' },
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_ROLE_SEED !== 'true') {
    throw new Error('Refusing to seed test accounts in production (set ALLOW_ROLE_SEED=true to override).')
  }
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/launcherdesk')

  const User = require('../models/User')
  const Partner = require('../models/Partner')
  const { User: PortalUser } = require('../models/portal')
  const { hashPassword } = require('../services/portal/password.service')
  const { generateAdminCode } = require('../services/portal/idGenerator.service')
  const adminsService = require('../services/portal/admins.service')
  const clientsService = require('../services/portal/clients.service')
  const { ROLES } = require('../constants/portal/roles')
  const { ALL_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } = require('../constants/portal/permissions')
  const { USER_STATUS } = require('../constants/portal/userStatus')

  const report = []
  const note = (role, acc, state) => report.push({ role, email: acc.email, password: acc.password, state })

  // ── LauncherDesk roles ─────────────────────────────────────────────────────
  for (const [key, role] of [['customer', 'user'], ['sales', 'sales'], ['legacyAdmin', 'admin'], ['partner', 'partner']]) {
    const acc = ACCOUNTS[key]
    if (await User.exists({ email: acc.email })) { note(role, acc, 'exists'); continue }
    const user = await User.create({ name: acc.name, email: acc.email, password: acc.password, role, emailVerified: true, phone: '9000000000' })
    if (role === 'partner') {
      await Partner.create({
        userId: user._id, companyName: acc.name, contactName: 'Partner Contact', email: acc.email,
        mobile: '9000000001', productName: 'Partner Product', status: 'approved', approvedAt: new Date(),
      })
    }
    note(role, acc, 'created')
  }

  // ── Portal roles ───────────────────────────────────────────────────────────
  const sa = ACCOUNTS.portalSuperAdmin
  let superAdmin = await PortalUser.findOne({ email: sa.email })
  if (!superAdmin) {
    // The first Super Admin has no actor to create it, so it is inserted directly
    // (the same fields admins.service.createAdmin sets).
    superAdmin = await PortalUser.create({
      name: sa.name, email: sa.email, passwordHash: await hashPassword(sa.password),
      role: ROLES.SUPER_ADMIN, status: USER_STATUS.ACTIVE, permissions: ALL_PERMISSIONS,
      adminCode: await generateAdminCode(),
    })
    note(ROLES.SUPER_ADMIN, sa, 'created')
  } else note(ROLES.SUPER_ADMIN, sa, 'exists')

  const ad = ACCOUNTS.portalAdmin
  if (!(await PortalUser.exists({ email: ad.email }))) {
    await adminsService.createAdmin(
      { name: ad.name, email: ad.email, password: ad.password, role: ROLES.ADMIN, department: 'Operations', permissions: DEFAULT_ADMIN_PERMISSIONS },
      superAdmin, {}
    )
    note(ROLES.ADMIN, ad, 'created')
  } else note(ROLES.ADMIN, ad, 'exists')

  const cl = ACCOUNTS.portalClient
  if (!(await PortalUser.exists({ email: cl.email }))) {
    await clientsService.createClient(
      { name: cl.name, email: cl.email, phone: '9876543210', companyName: 'Client Ventures Pvt Ltd', city: 'Bengaluru', state: 'Karnataka' },
      superAdmin, {}
    )
    // createClient issues a random temporary password and leaves the login PENDING until
    // the client is activated; set a known password and activate it for testing.
    await PortalUser.updateOne({ email: cl.email }, { $set: { passwordHash: await hashPassword(cl.password), status: USER_STATUS.ACTIVE } })
    const { Client } = require('../models/portal')
    await Client.updateOne({ email: cl.email }, { $set: { status: 'ACTIVE' } })
    note(ROLES.CLIENT, cl, 'created')
  } else note(ROLES.CLIENT, cl, 'exists')

  console.table(report)
  await mongoose.disconnect()
}

main().catch(err => { console.error('Seeding failed:', err.message); process.exit(1) })
