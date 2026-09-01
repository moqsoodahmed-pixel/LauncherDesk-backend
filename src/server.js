require('dotenv').config()
const express    = require('express')
const cors       = require('cors')
const rateLimit  = require('express-rate-limit')
const path       = require('path')
const connectDB  = require('./config/db')

// Route imports
const contactRoutes     = require('./routes/contact')
const serviceRoutes     = require('./routes/services')
const blogRoutes        = require('./routes/blogs')
const faqRoutes         = require('./routes/faqs')
const leadRoutes        = require('./routes/leads')
const authRoutes        = require('./routes/auth')
const quoteRoutes       = require('./routes/quotes')
const applicationRoutes = require('./routes/applications')
const marketRoutes      = require('./routes/market')
const voiceflowRoutes   = require('./routes/voiceflow')
const adminRoutes       = require('./routes/admin')
const partnerRoutes     = require('./routes/partners')
// const paymentRoutes = require('./routes/payments') // uncomment after adding Razorpay keys
// const salesRoutes   = require('./routes/sales')     // push sales.js to repo first

// Connect to MongoDB
connectDB()

const app = express()

// ── Middleware ────────────────────────────────────────────────────────────────

// CORS — allow all LauncherDesk domains + localhost dev
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://launcherdesk.com',
  'https://www.launcherdesk.com',
  'https://launcherdesk.net',
  'https://www.launcherdesk.net',
  'https://launcherdesk-frontend-7wj.pages.dev',
  process.env.CLIENT_URL,
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    // Allow any *.pages.dev or *.launcherdesk.* preview deploy
    if (/\.pages\.dev$/.test(origin) || /launcherdesk\.(com|net)$/.test(origin)) return callback(null, true)
    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}))

// Handle preflight requests
app.options('*', cors())

// Body parsers
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

// Global rate limiter — 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests. Please try again later.' },
})
app.use('/api/', limiter)

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes)
app.use('/api/contact',      contactRoutes)
app.use('/api/leads',        leadRoutes)
app.use('/api/quotes',       quoteRoutes)
app.use('/api/services',     serviceRoutes)
app.use('/api/blogs',        blogRoutes)
app.use('/api/faqs',         faqRoutes)
app.use('/api/applications', applicationRoutes)
app.use('/api/market',       marketRoutes)
// app.use('/api/payments', paymentRoutes) // uncomment after adding Razorpay keys
// app.use('/api/sales',    salesRoutes)   // uncomment after pushing sales.js to repo
app.use('/api/voiceflow',    voiceflowRoutes)
app.use('/api/admin',        adminRoutes)
app.use('/api/partners',     partnerRoutes)

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'LauncherDesk API is running', timestamp: new Date() })
})

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` })
})

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack)
  const status = err.statusCode || 500
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀  LauncherDesk API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
})