/**
 * Creates a sales team user.
 * Usage: node src/scripts/seedSalesUser.js
 * Set SALES_EMAIL, SALES_NAME, SALES_PASSWORD env vars or edit the defaults below.
 */
require('dotenv').config()
const mongoose = require('mongoose')
const User     = require('../models/User')

const NAME     = process.env.SALES_NAME     || 'Sales User'
const EMAIL    = process.env.SALES_EMAIL    || 'sales@launcherdesk.com'
const PASSWORD = process.env.SALES_PASSWORD || 'Sales@123'

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to MongoDB')

  const existing = await User.findOne({ email: EMAIL })
  if (existing) {
    existing.role = 'sales'
    existing.name = NAME
    await existing.save()
    console.log(`Updated existing user ${EMAIL} → role: sales`)
  } else {
    await User.create({ name: NAME, email: EMAIL, password: PASSWORD, role: 'sales' })
    console.log(`Created sales user: ${EMAIL} / ${PASSWORD}`)
  }
  await mongoose.disconnect()
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })