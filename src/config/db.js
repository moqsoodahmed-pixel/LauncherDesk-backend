const mongoose = require('mongoose')

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    })
    console.log(`✅  MongoDB connected: ${conn.connection.host}`)
    await ensureIndexes()
  } catch (err) {
    console.error(`❌  MongoDB connection error: ${err.message}`)
    process.exit(1)
  }
}

async function ensureIndexes() {
  try {
    const db = mongoose.connection.db
    await db.collection('leads').createIndex({ email: 1 })
    await db.collection('leads').createIndex({ status: 1 })
    await db.collection('leads').createIndex({ assignedTo: 1 })
    await db.collection('leads').createIndex({ createdAt: -1 })
    await db.collection('contacts').createIndex({ email: 1 })
    await db.collection('contacts').createIndex({ status: 1 })
    await db.collection('contacts').createIndex({ assignedTo: 1 })
    await db.collection('contacts').createIndex({ followUpDate: 1 })
    await db.collection('contacts').createIndex({ createdAt: -1 })
    await db.collection('quotes').createIndex({ email: 1 })
    await db.collection('quotes').createIndex({ status: 1 })
    await db.collection('quotes').createIndex({ serviceSlug: 1 })
    await db.collection('quotes').createIndex({ createdAt: -1 })
    await db.collection('applications').createIndex({ email: 1 })
    await db.collection('applications').createIndex({ status: 1 })
    await db.collection('applications').createIndex({ createdAt: -1 })
    await db.collection('blogs').createIndex({ slug: 1 }, { unique: true, background: true })
    await db.collection('blogs').createIndex({ isPublished: 1, publishedAt: -1 })
    await db.collection('services').createIndex({ slug: 1 }, { unique: true, background: true })
    await db.collection('services').createIndex({ isActive: 1, sortOrder: 1 })
    await db.collection('faqs').createIndex({ serviceSlug: 1 })
    await db.collection('faqs').createIndex({ isActive: 1, sortOrder: 1 })
    await db.collection('partners').createIndex({ email: 1 })
    await db.collection('partners').createIndex({ status: 1, approvedAt: -1 })
    await db.collection('partners').createIndex({ userId: 1 })
    await db.collection('partnerleads').createIndex({ partnerId: 1, createdAt: -1 })
    await db.collection('payments').createIndex({ user: 1, status: 1 })
    await db.collection('payments').createIndex({ razorpayOrderId: 1 }, { unique: true, sparse: true, background: true })
    await db.collection('payments').createIndex({ createdAt: -1 })
    await db.collection('serviceorders').createIndex({ user: 1, status: 1 })
    await db.collection('serviceorders').createIndex({ user: 1, createdAt: -1 })
    await db.collection('serviceorders').createIndex({ serviceSlug: 1 })
    await db.collection('servicedocuments').createIndex({ order: 1, type: 1 })
    await db.collection('servicedocuments').createIndex({ user: 1, status: 1 })
    await db.collection('products').createIndex({ slug: 1 }, { unique: true, background: true })
    await db.collection('products').createIndex({ isActive: 1, category: 1 })
    console.log('✅  MongoDB indexes ensured')
  } catch (err) {
    console.warn('⚠️  Index creation warning:', err.message)
  }
}

module.exports = connectDB
