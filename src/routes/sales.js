/**
 * Sales Team Routes — /api/sales/*
 * Accessible by role: 'admin' OR 'sales'
 * Sales users can view all leads/contacts/quotes and update status + notes.
 * They cannot delete records or access applications/partners/settings.
 */
const router  = require('express').Router()
const Contact = require('../models/Contact')
const Lead    = require('../models/Lead')
const Quote   = require('../models/Quote')
const User    = require('../models/User')
const { protect, restrictTo } = require('../middleware/auth')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

// ── POST /api/sales/create-user  (public — but requires SALES_CREATE_SECRET)
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

// All sales routes require login + sales or admin role
router.use(protect, restrictTo('admin', 'sales'))

/* ── Dashboard stats ─────────────────────────────────────────────────────── */
router.get('/stats', asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin'
  const myId    = req.user._id

  const [contacts, leads, quotes] = await Promise.all([
    Contact.countDocuments(),
    Lead.countDocuments(),
    Quote.countDocuments(),
  ])

  const [contactsByStatus, leadsByStatus, quotesByStatus] = await Promise.all([
    Contact.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Lead.aggregate([   { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Quote.aggregate([  { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ])

  // My assigned leads count
  const myLeads    = await Lead.countDocuments({ assignedTo: myId })
  const myContacts = await Contact.countDocuments({ assignedTo: myId })

  // Today's follow-ups
  const today = new Date(); today.setHours(0,0,0,0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1)
  const followUps = await Contact.countDocuments({ followUpDate: { $gte: today, $lt: tomorrow } })

  res.json({
    success: true,
    data: {
      totals: { contacts, leads, quotes },
      myLeads, myContacts, followUps,
      contactsByStatus: Object.fromEntries(contactsByStatus.map(s => [s._id, s.count])),
      leadsByStatus:    Object.fromEntries(leadsByStatus.map(s    => [s._id, s.count])),
      quotesByStatus:   Object.fromEntries(quotesByStatus.map(s   => [s._id, s.count])),
    },
  })
}))

/* ── Recent items for dashboard ─────────────────────────────────────────── */
router.get('/recent', asyncHandler(async (_req, res) => {
  const [contacts, leads, quotes] = await Promise.all([
    Contact.find().sort({ createdAt: -1 }).limit(8).populate('assignedTo', 'name'),
    Lead.find().sort({    createdAt: -1 }).limit(8).populate('assignedTo', 'name'),
    Quote.find().sort({   createdAt: -1 }).limit(8),
  ])
  res.json({ success: true, data: { contacts, leads, quotes } })
}))

/* ── Sales team members list (for assignment dropdown) ───────────────────── */
router.get('/team', asyncHandler(async (_req, res) => {
  const team = await User.find({ role: { $in: ['admin','sales'] }, isActive: true }).select('name email role')
  res.json({ success: true, data: team })
}))

/* ── Contacts ────────────────────────────────────────────────────────────── */
router.get('/contacts', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, q, assignedTo } = req.query
  const filter = {}
  if (status && status !== 'all') filter.status = status
  if (assignedTo) filter.assignedTo = assignedTo
  const skip = (Number(page)-1) * Number(limit)

  let query = Contact.find(filter).populate('assignedTo','name').sort({ createdAt: -1 })

  const [data, total] = await Promise.all([
    query.skip(skip).limit(Number(limit)),
    Contact.countDocuments(filter),
  ])
  res.json({ success: true, data, total, page: Number(page) })
}))

router.patch('/contacts/:id', asyncHandler(async (req, res, next) => {
  const allowed = ['status','notes','assignedTo','followUpDate','lastContactedAt']
  const update  = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  const doc = await Contact.findByIdAndUpdate(req.params.id, update, { new: true }).populate('assignedTo','name')
  if (!doc) return next(new AppError('Contact not found', 404))
  res.json({ success: true, data: doc })
}))

/* ── Leads ───────────────────────────────────────────────────────────────── */
router.get('/leads', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, assignedTo } = req.query
  const filter = {}
  if (status && status !== 'all') filter.status = status
  if (assignedTo) filter.assignedTo = assignedTo
  const skip = (Number(page)-1) * Number(limit)

  const [data, total] = await Promise.all([
    Lead.find(filter).populate('assignedTo','name').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Lead.countDocuments(filter),
  ])
  res.json({ success: true, data, total, page: Number(page) })
}))

router.patch('/leads/:id', asyncHandler(async (req, res, next) => {
  const allowed = ['status','assignedTo','message']
  const update  = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  const doc = await Lead.findByIdAndUpdate(req.params.id, update, { new: true }).populate('assignedTo','name')
  if (!doc) return next(new AppError('Lead not found', 404))
  res.json({ success: true, data: doc })
}))

/* ── Quotes ──────────────────────────────────────────────────────────────── */
router.get('/quotes', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query
  const filter = {}
  if (status && status !== 'all') filter.status = status
  const skip = (Number(page)-1) * Number(limit)

  const [data, total] = await Promise.all([
    Quote.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Quote.countDocuments(filter),
  ])
  res.json({ success: true, data, total, page: Number(page) })
}))

router.patch('/quotes/:id', asyncHandler(async (req, res, next) => {
  const allowed = ['status','adminNotes','quotedAmount']
  const update  = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  const doc = await Quote.findByIdAndUpdate(req.params.id, update, { new: true })
  if (!doc) return next(new AppError('Quote not found', 404))
  res.json({ success: true, data: doc })
}))

module.exports = router