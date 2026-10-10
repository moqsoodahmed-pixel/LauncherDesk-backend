require('dotenv').config()

// Fail loudly instead of silently signing tokens with a guessable,
// checked-into-source fallback secret (authController.js, routes/auth.js,
// services/otpService.js all previously fell back to a hardcoded string
// when this env var was unset).
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required and must not be empty.')
}

const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const cookieParser = require('cookie-parser')
const mongoSanitize = require('express-mongo-sanitize')
const path = require('path')
const connectDB = require('./config/db')

const contactRoutes = require('./routes/contact')
const serviceRoutes = require('./routes/services')
const blogRoutes = require('./routes/blogs')
const faqRoutes = require('./routes/faqs')
const leadRoutes = require('./routes/leads')
const authRoutes = require('./routes/auth')
const quoteRoutes = require('./routes/quotes')
const applicationRoutes = require('./routes/applications')
const marketRoutes = require('./routes/market')
const voiceflowRoutes = require('./routes/voiceflow')
const adminRoutes = require('./routes/admin')
const partnerRoutes = require('./routes/partners')
const salesRoutes = require('./routes/sales')
const paymentRoutes = require('./routes/payments')
const userRoutes = require('./routes/user')

connectDB().then(async () => {
  // Notification engine background jobs (email queue / retries, document reminders, feedback)
  require('./services/scheduler').start()
  // Portal data backfills that the standalone Portal ran on every boot (idempotent)
  await require('./services/portal/startupMigrations.service').runPortalStartupMigrations()
})

const app = express()
app.set('trust proxy', 1)

/* ── CORS ─────────────────────────────────────────────────────────────── */
// Registered FIRST so every response — preflights, errors, 404s, rate-limit and 503 replies —
// carries the CORS headers. Disallowed origins simply get no CORS headers (no thrown error,
// which used to turn into a 500 without headers).
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://launcherdesk.com',
  'https://www.launcherdesk.com',
  'https://launcherdesk.net',
  'https://www.launcherdesk.net',
  'https://launcherdesk-frontend-7wj.pages.dev',
  ...(process.env.CLIENT_URL || '').split(',').map(s => s.trim().replace(/\/$/, '')),
  ...(process.env.EXTRA_CORS_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')),
].filter(Boolean)

const isAllowedOrigin = (origin) =>
  ALLOWED_ORIGINS.includes(origin) ||
  /^https:\/\/([a-z0-9-]+\.)*launcherdesk\.(com|net)$/i.test(origin) ||   // any launcherdesk subdomain
  /^https:\/\/launcherdesk-[a-z0-9-]+\.pages\.dev$/i.test(origin) ||        // Cloudflare Pages previews
  /^https:\/\/[a-z0-9-]+\.launcherdesk-frontend-7wj\.pages\.dev$/i.test(origin)

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true)
    console.warn(`[CORS] Blocked origin: ${origin}`)
    callback(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Disposition'],
  maxAge: 86400,          // browsers cache the preflight for a day
  optionsSuccessStatus: 204,
}
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

/* ── Security headers ─────────────────────────────────────────────────── */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}))
app.use(helmet.noSniff())
app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }))

/* ── Razorpay webhook — needs the RAW body for signature verification, so it is
   mounted before express.json(). Not rate-limited (Razorpay retries on failure). */
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), require('./controllers/paymentController').webhook)

/* ── Portal Razorpay webhook — also needs raw body, mounted before json parser ── */
app.use('/api/portal/webhooks', require('./routes/portal/webhooks.routes'))

/* ── Body parsing ─────────────────────────────────────────────────────── */
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))
app.use(cookieParser())
app.use(mongoSanitize())
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

/* ── Rate limiting ────────────────────────────────────────────────────── */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 5000 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
  // Portal routes keep the Portal's own limiter (RATE_LIMIT_MAX, default 300).
  // Payments already have their own dedicated, separate limiter further
  // below (`paymentLimiter`, 30/15min) — but until this fix, that limiter
  // ran IN ADDITION TO this one, not instead of it, so payment requests
  // were still also counted against this shared, site-wide 200/15min
  // budget. On Indian mobile networks many genuinely different customers
  // share one carrier-assigned public IP (CGNAT), so unrelated site
  // browsing from other customers on the same IP could exhaust this
  // budget and block a mobile customer's checkout before they ever came
  // close to their own 30-request payment-specific limit — a real,
  // mobile-disproportionate failure mode a desktop/broadband user would
  // almost never hit. Payments are now exempt here and rely solely on
  // their own dedicated limiter.
  skip: (req) => req.originalUrl.startsWith('/api/portal') || req.originalUrl.startsWith('/api/payments'),
})
app.use('/api/', globalLimiter)

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
})
app.use('/api/auth/login', authLimiter)
app.use('/api/auth/register', authLimiter)
app.use('/api/auth/otp', authLimiter)

const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: 'Too many submissions. Please try again later.' },
})
app.use('/api/contact', formLimiter)
app.use('/api/quotes', formLimiter)
app.use('/api/leads', formLimiter)

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

/* ── Health + database guard ──────────────────────────────────────────── */
app.get('/api/health', (_req, res) => {
  const db = connectDB.isDbReady() ? 'connected' : 'disconnected'
  res.status(db === 'connected' ? 200 : 503).json({ success: db === 'connected', status: 'LauncherDesk API is running', database: db, timestamp: new Date() })
})

// While MongoDB is unreachable, answer immediately with a clear JSON error (CORS headers
// included) instead of hanging or crashing. The Razorpay webhook above is unaffected.
app.use('/api', (req, res, next) => {
  if (connectDB.isDbReady()) return next()
  res.status(503).json({ success: false, message: 'Our servers are temporarily unavailable. Please try again in a minute.' })
})

/* ── Routes ───────────────────────────────────────────────────────────── */
app.use('/api/auth', authRoutes)
app.use('/api/contact', contactRoutes)
app.use('/api/leads', leadRoutes)
app.use('/api/quotes', quoteRoutes)
app.use('/api/services', serviceRoutes)
app.use('/api/blogs', blogRoutes)
app.use('/api/faqs', faqRoutes)
app.use('/api/applications', applicationRoutes)
app.use('/api/market', marketRoutes)
app.use('/api/voiceflow', voiceflowRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/partners', partnerRoutes)
app.use('/api/sales', salesRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/user', require('./routes/customerOps'))   // documents, invoices, timeline, tickets
app.use('/api/user', userRoutes)
app.use('/api/admin/ops', require('./routes/adminOps'))  // order ops, communication history, templates, settings

/* ── Portal routes (all under /api/portal/) ──────────────────────────── */
// Same middleware chain the standalone Portal app applied to its API:
// XSS sanitising → maintenance-mode gate → Portal rate limiter → routes.
app.use('/api/portal', require('xss-clean')())
app.use('/api/portal', require('./middleware/portal/maintenanceMode'))
app.use('/api/portal', require('./middleware/portal/rateLimiters').generalLimiter)
app.use('/api/portal', require('./routes/portal/index'))
// Portal 404 + error responses keep the Portal's own shape ({ success, message, code, details })
// that its UI reads (e.g. validation `details` in the order forms); internal errors stay generic.
{
  const { notFoundHandler, errorHandler: portalErrorHandler } = require('./middleware/portal/errorHandler')
  app.use('/api/portal', notFoundHandler)
  app.use('/api/portal', portalErrorHandler)
}

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
app.listen(PORT, () => {
  console.log(`🚀  LauncherDesk API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
  if (!process.env.RAZORPAY_KEY_ID) console.warn('⚠️   RAZORPAY_KEY_ID not set — payments will return 503')
  else console.log(`💳  Razorpay configured with Key ID: ${process.env.RAZORPAY_KEY_ID}`)
  if (!process.env.BREVO_API_KEY && !process.env.EMAIL_PROVIDER) console.warn('⚠️   No email provider configured — emails are printed to the console (EMAIL_PROVIDER=console)')
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) console.warn('⚠️   RAZORPAY_WEBHOOK_SECRET not set — Razorpay webhooks will be rejected')
  if (!process.env.GROQ_API_KEY) console.warn('⚠️   GROQ_API_KEY not set — AI will use fallback message')
})