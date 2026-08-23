/**
 * One-time script to create the admin user for LauncherDesk.
 * Run: node src/scripts/seedAdmin.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const mongoose = require('mongoose')
const User     = require('../models/User')

const ADMIN = {
  name:     'Moqsood Admin',
  email:    'moqsood@launcherdesk.com',   // maps to username "moqsood" in the frontend
  password: 'moqsood@123',
  role:     'admin',
  isActive: true,
}

;(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 })
    console.log('✅  MongoDB connected')

    const existing = await User.findOne({ email: ADMIN.email })
    if (existing) {
      // Update role + password in case it drifted
      existing.role     = 'admin'
      existing.password = ADMIN.password   // pre-save hook will rehash
      await existing.save()
      console.log('♻️   Admin user updated:', ADMIN.email)
    } else {
      await User.create(ADMIN)
      console.log('🆕  Admin user created:', ADMIN.email)
    }

    console.log('\n  Username : moqsood')
    console.log('  Password : moqsood@123')
    console.log('  Role     : admin\n')
  } catch (err) {
    console.error('❌  Seed error:', err.message)
  } finally {
    await mongoose.disconnect()
    process.exit(0)
  }
})()
