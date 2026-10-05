const mongoose = require('mongoose')

// Connect to MongoDB without ever killing the process. Previously a failed connection called
// process.exit(1): the host restarted the app in a loop and every browser request failed with
// "Failed to fetch" (the host's error page has no CORS headers). Now the API stays up, answers
// with a clear 503 JSON error while the database is unreachable, and keeps retrying.
let indexesEnsured = false
mongoose.connection.on('disconnected', () => console.warn('⚠️   MongoDB disconnected — mongoose will reconnect automatically'))
mongoose.connection.on('reconnected', () => console.log('✅  MongoDB reconnected'))

const connectDB = async (attempt = 1) => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/launcherdesk'
  if (!process.env.MONGO_URI && attempt === 1) {
    console.warn('⚠️   MONGO_URI not specified in .env, falling back to mongodb://localhost:27017/launcherdesk')
  }

  try {
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
    console.log(`✅  MongoDB connected: ${conn.connection.host}`)
    if (!indexesEnsured) { indexesEnsured = true; await ensureIndexes() }
    return conn
  } catch (err) {
    const delay = Math.min(30000, 2000 * attempt)
    console.error(`❌  MongoDB connection error (attempt ${attempt}): ${err.message} — retrying in ${delay / 1000}s`)
    console.error('    Check MONGO_URI, the Atlas cluster status (not paused) and Atlas Network Access (allow your host\'s IP or 0.0.0.0/0).')
    await new Promise(r => setTimeout(r, delay))
    return connectDB(attempt + 1)
  }
}

const isDbReady = () => mongoose.connection.readyState === 1

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
module.exports.isDbReady = isDbReady