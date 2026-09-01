/**
 * Sales Team Routes — /api/sales/*
 * Accessible by role: 'admin' OR 'sales'
 */
const router  = require('express').Router()
const Contact = require('../models/Contact')
const Lead    = require('../models/Lead')
const Quote   = require('../models/Quote')
const User    = require('../models/User')
const { protect, restrictTo } = require('../middleware/auth')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

// ── POST /api/sales/create-user (public — requires SALES_CREATE_SECRET)
router.post('/create-user', asyncHandler(async (req, res, next) => {
  const { name, email, password, phone, adminKey } = req.body
  if (!name || !email || !password) return next(new AppError('Name, email and password are required', 400))
  if (!adminKey) return next(new AppError('Admin secret key is required', 400))
  if (adminKey !== process.env.SALES_CREATE_SECRET) return next(new AppError('Invalid admin secret key', 403))
  const existing = await User.findOne({ email })
  if (existing) return next(new AppError('Email already registered', 409))
  const user = await User.create({ name, email, password, phone, role: 'sales' })
  console.log(`[Sales] New sales user created: ${email}`)
  res.status(201).json({ success: true, message: `Sales user "${name}" created successfully`, data: { id: user._id, name, email } })
}))

// All routes below require auth
router.use(protect, restrictTo('admin', 'sales'))

// ── GET /api/sales/stats
router.get('/stats', asyncHandler(async (_req, res) => {
  const [contacts, leads, quotes,
    newContacts, newLeads, newQuotes,
    convertedLeads, workingLeads,
  ] = await Promise.all([
    Contact.countDocuments(),
    Lead.countDocuments(),
    Quote.countDocuments(),
    Contact.countDocuments({ status: 'new' }),
    Lead.countDocuments({ status: 'new' }),
    Quote.countDocuments({ status: 'pending' }),
    Lead.countDocuments({ status: 'converted' }),
    Lead.countDocuments({ status: 'working' }),
  ])
  const total = contacts + leads + quotes
  res.json({ success: true, data: { total, contacts, leads, quotes, newContacts, newLeads, newQuotes, convertedLeads, workingLeads } })
}))

// ── GET /api/sales/all-enquiries — unified view of all form submissions
router.get('/all-enquiries', asyncHandler(async (req, res) => {
  const { source, status, page = 1, limit = 30, q } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  // Build search filter
  const searchFilter = q ? {
    $or: [
      { name:  { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { mobile:{ $regex: q, $options: 'i' } },
    ]
  } : {}

  // Fetch all three collections in parallel
  const [contacts, leads, quotes] = await Promise.all([
    (!source || source === 'contact')
      ? Contact.find({ ...searchFilter, ...(status && status !== 'all' ? { status } : {}) })
          .sort({ createdAt: -1 }).lean()
      : [],
    (!source || source === 'lead')
      ? Lead.find({ ...searchFilter, ...(status && status !== 'all' ? { status } : {}) })
          .sort({ createdAt: -1 }).lean()
      : [],
    (!source || source === 'quote')
      ? Quote.find({ ...searchFilter, ...(status && status !== 'all' ? { status } : {}) })
          .sort({ createdAt: -1 }).lean()
      : [],
  ])

  // Normalise into unified format
  const all = [
    ...contacts.map(c => ({
      _id:       c._id,
      source:    'Contact Form',
      sourceTag: 'contact',
      name:      c.name,
      email:     c.email,
      mobile:    c.mobile,
      state:     c.state,
      service:   c.service || '—',
      message:   c.message,
      status:    c.status,
      notes:     c.notes,
      followUpDate: c.followUpDate,
      whatsapp:  c.whatsappOptin,
      createdAt: c.createdAt,
      raw:       c,
    })),
    ...leads.map(l => ({
      _id:       l._id,
      source:    'Service Enquiry',
      sourceTag: 'lead',
      name:      l.name,
      email:     l.email,
      mobile:    l.mobile,
      state:     l.state,
      service:   l.serviceInterest || l.businessType || '—',
      message:   l.message,
      status:    l.status,
      notes:     null,
      followUpDate: l.followUpDate,
      whatsapp:  true,
      createdAt: l.createdAt,
      raw:       l,
    })),
    ...quotes.map(q => ({
      _id:       q._id,
      source:    'Quote Request',
      sourceTag: 'quote',
      name:      q.name,
      email:     q.email,
      mobile:    q.mobile,
      state:     q.state,
      service:   q.serviceTitle || q.serviceSlug,
      message:   q.additionalInfo,
      status:    q.status,
      notes:     q.adminNotes,
      followUpDate: null,
      whatsapp:  true,
      createdAt: q.createdAt,
      raw:       q,
    })),
  ]

  // Sort all by createdAt desc
  all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  const total = all.length
  const paginated = all.slice(skip, skip + Number(limit))

  res.json({ success: true, total, page: Number(page), data: paginated })
}))

// ── PATCH /api/sales/contacts/:id
router.patch('/contacts/:id', asyncHandler(async (req, res, next) => {
  const { status, notes, assignedTo, followUpDate, lastContactedAt } = req.body
  const update = {}
  if (status)              update.status           = status
  if (notes !== undefined) update.notes            = notes
  if (assignedTo)          update.assignedTo       = assignedTo
  if (followUpDate)        update.followUpDate     = followUpDate
  if (lastContactedAt)     update.lastContactedAt  = lastContactedAt
  const doc = await Contact.findByIdAndUpdate(req.params.id, update, { new: true }).populate('assignedTo', 'name email')
  if (!doc) return res.status(404).json({ success: false, message: 'Not found' })
  res.json({ success: true, data: doc })
}))

// ── PATCH /api/sales/leads/:id
router.patch('/leads/:id', asyncHandler(async (req, res, next) => {
  const { status, notes, assignedTo, followUpDate } = req.body
  const update = {}
  if (status)              update.status      = status
  if (notes !== undefined) update.notes       = notes
  if (assignedTo)          update.assignedTo  = assignedTo
  if (followUpDate)        update.followUpDate = followUpDate
  const doc = await Lead.findByIdAndUpdate(req.params.id, update, { new: true }).populate('assignedTo', 'name email')
  if (!doc) return res.status(404).json({ success: false, message: 'Not found' })
  res.json({ success: true, data: doc })
}))

// ── PATCH /api/sales/quotes/:id
router.patch('/quotes/:id', asyncHandler(async (req, res, next) => {
  const doc = await Quote.findByIdAndUpdate(req.params.id, req.body, { new: true })
  if (!doc) return res.status(404).json({ success: false, message: 'Not found' })
  res.json({ success: true, data: doc })
}))

// ── GET /api/sales/team
router.get('/team', asyncHandler(async (_req, res) => {
  const team = await User.find({ role: { $in: ['sales', 'admin'] } }).select('name email role')
  res.json({ success: true, data: team })
}))

// ── GET /api/sales/recent
router.get('/recent', asyncHandler(async (_req, res) => {
  const [contacts, leads, quotes] = await Promise.all([
    Contact.find().sort({ createdAt: -1 }).limit(6).lean(),
    Lead.find().sort({ createdAt: -1 }).limit(6).lean(),
    Quote.find().sort({ createdAt: -1 }).limit(6).lean(),
  ])
  res.json({ success: true, data: { contacts, leads, quotes } })
}))

module.exports = router