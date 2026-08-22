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
const voiceflowRoutes   = require('./routes/voiceflow')   // ← Voiceflow

// Connect to MongoDB
connectDB()

const app = express()

// ── Middleware ────────────────────────────────────────────────────────────────

// CORS
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}))

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
app.use('/api/voiceflow',    voiceflowRoutes)              // ← Voiceflow

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
app.listen(PORT, () => {
  console.log(`🚀  LauncherDesk API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
})