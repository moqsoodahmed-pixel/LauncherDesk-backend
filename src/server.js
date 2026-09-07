require('dotenv').config()
const express    = require('express')
const cors       = require('cors')
const helmet     = require('helmet')
const rateLimit  = require('express-rate-limit')
const path       = require('path')
const connectDB  = require('./config/db')

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
const salesRoutes       = require('./routes/sales')
const paymentRoutes     = require('./routes/payments')
const userRoutes        = require('./routes/user')

connectDB()

const app = express()
app.set('trust proxy', 1)

/* ── CORS ─────────────────────────────────────────────────────────────── */
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
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    // Allow Cloudflare Pages preview deployments for this project only
    if (/^https:\/\/launcherdesk-[a-z0-9-]+\.pages\.dev$/.test(origin)) return callback(null, true)
    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
}))
app.options('*', cors())

/* ── Security headers ─────────────────────────────────────────────────── */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}))
app.use(helmet.noSniff())
app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }))

/* ── Body parsing ─────────────────────────────────────────────────────── */
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

/* ── Rate limiting ────────────────────────────────────────────────────── */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
})
app.use('/api/', globalLimiter)

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
})
app.use('/api/auth/login',    authLimiter)
app.use('/api/auth/register', authLimiter)

const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: 'Too many submissions. Please try again later.' },
})
app.use('/api/contact', formLimiter)
app.use('/api/quotes',  formLimiter)
app.use('/api/leads',   formLimiter)

const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many AI requests. Please wait a moment.' },
})
app.use('/api/voiceflow/interact', aiLimiter)

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many payment requests. Please try again later.' },
})
app.use('/api/payments', paymentLimiter)

/* ── Routes ───────────────────────────────────────────────────────────── */
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
  if (status === 500) console.error(`[Error] ${req.method} ${req.originalUrl} — ${err.message}`)
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀  LauncherDesk API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
  if (!process.env.RAZORPAY_KEY_ID)  console.warn('⚠️   RAZORPAY_KEY_ID not set — payments will return 503')
  if (!process.env.BREVO_API_KEY)    console.warn('⚠️   BREVO_API_KEY not set — emails will fail')
  if (!process.env.GROQ_API_KEY)     console.warn('⚠️   GROQ_API_KEY not set — AI will use fallback')
})
