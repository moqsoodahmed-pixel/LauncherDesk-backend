/**
 * One-time script to create the admin user for LauncherDesk.
 * Run: node src/scripts/seedAdmin.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const mongoose = require('mongoose')
const User     = require('../models/User')

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'moqsood@launcherdesk.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'moqsood@123'
const ADMIN_NAME = process.env.ADMIN_NAME || 'Moqsood Admin'

const ADMIN = {
  name:     ADMIN_NAME,
  email:    ADMIN_EMAIL,
  password: ADMIN_PASSWORD,
  role:     'admin',
  isActive: true,
}

;(async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/launcherdesk'
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 })
    console.log('✅  MongoDB connected')

    // 1. Seed LauncherDesk Legacy Admin
    const existing = await User.findOne({ email: ADMIN.email })
    if (existing) {
      existing.role     = 'admin'
      existing.password = ADMIN.password   // pre-save hook will rehash
      await existing.save()
      console.log('♻️   LauncherDesk Admin user updated:', ADMIN.email)
    } else {
      await User.create(ADMIN)
      console.log('🆕  LauncherDesk Admin user created:', ADMIN.email)
    }

    // 2. Seed Portal Super Admin
    const { User: PortalUser } = require('../models/portal')
    const { hashPassword } = require('../services/portal/password.service')
    const { generateAdminCode } = require('../services/portal/idGenerator.service')
    const { ALL_PERMISSIONS } = require('../constants/portal/permissions')
    const { ROLES } = require('../constants/portal/roles')
    const { USER_STATUS } = require('../constants/portal/userStatus')

    const existingPortalUser = await PortalUser.findOne({ email: ADMIN.email })
    if (existingPortalUser) {
      existingPortalUser.role = ROLES.SUPER_ADMIN
      existingPortalUser.permissions = ALL_PERMISSIONS
      existingPortalUser.status = USER_STATUS.ACTIVE
      existingPortalUser.passwordHash = await hashPassword(ADMIN.password)
      if (!existingPortalUser.adminCode) {
        existingPortalUser.adminCode = await generateAdminCode()
      }
      await existingPortalUser.save()
      console.log('♻️   Portal Super Admin updated:', ADMIN.email)
    } else {
      const adminCode = await generateAdminCode()
      await PortalUser.create({
        name: ADMIN.name,
        email: ADMIN.email,
        passwordHash: await hashPassword(ADMIN.password),
        role: ROLES.SUPER_ADMIN,
        permissions: ALL_PERMISSIONS,
        status: USER_STATUS.ACTIVE,
        adminCode,
        notificationPreferences: { inAppEnabled: true }
      })
      console.log('🆕  Portal Super Admin created:', ADMIN.email)
    }

    console.log('\n=======================================')
    console.log('  Email    : ' + ADMIN.email)
    console.log('  Password : ' + ADMIN.password)
    console.log('  Roles    : LauncherDesk Admin & Portal Super Admin')
    console.log('=======================================\n')
  } catch (err) {
    console.error('❌  Seed error:', err.message)
  } finally {
    await mongoose.disconnect()
    process.exit(0)
  }
})()
