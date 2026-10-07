// Testable Express app — no DB connect, no listen
require('dotenv').config()
const express   = require('express')
const cors      = require('cors')
const helmet    = require('helmet')
const rateLimit = require('express-rate-limit')
const path      = require('path')

const contactRoutes     = require('../src/routes/contact')
const serviceRoutes     = require('../src/routes/services')
const blogRoutes        = require('../src/routes/blogs')
const faqRoutes         = require('../src/routes/faqs')
const leadRoutes        = require('../src/routes/leads')
const authRoutes        = require('../src/routes/auth')
const quoteRoutes       = require('../src/routes/quotes')
const applicationRoutes = require('../src/routes/applications')
const marketRoutes      = require('../src/routes/market')
const voiceflowRoutes   = require('../src/routes/voiceflow')
const adminRoutes       = require('../src/routes/admin')
const partnerRoutes     = require('../src/routes/partners')
const salesRoutes       = require('../src/routes/sales')
const paymentRoutes     = require('../src/routes/payments')
const userRoutes        = require('../src/routes/user')

const app = express()
app.set('trust proxy', 1)

app.use(cors({ origin: '*', credentials: true }))
app.options('*', cors())
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

app.use('/api/auth',         authRoutes)
app.use('/api/contact',      contactRoutes)
app.use('/api/leads',        leadRoutes)
app.use('/api/quotes',       quoteRoutes)
app.use('/api/services',     serviceRoutes)
app.use('/api/blogs',        blogRoutes)
app.use('/api/faqs',         faqRoutes)
app.use('/api/applications', applicationRoutes)
app.use('/api/market',       marketRoutes)
app.use('/api/voiceflow',    voiceflowRoutes)
app.use('/api/admin',        adminRoutes)
app.use('/api/partners',     partnerRoutes)
app.use('/api/sales',        salesRoutes)
app.use('/api/payments',     paymentRoutes)
app.use('/api/user',         userRoutes)

app.get('/api/health', (_req, res) => {
  res.json({ success: true, status: 'LauncherDesk API is running', timestamp: new Date() })
})

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` })
})

app.use((err, req, res, _next) => {
  const status = err.statusCode || 500
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
  })
})

module.exports = app
