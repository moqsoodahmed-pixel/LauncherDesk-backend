const router      = require('express').Router()
const bcrypt      = require('bcryptjs')
const jwt         = require('jsonwebtoken')
const Partner     = require('../models/Partner')
const PartnerLead = require('../models/PartnerLead')
const User        = require('../models/User')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { protect, restrictTo }    = require('../middleware/auth')

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' })

/** Middleware: allow access if user is admin OR the partner linked to the account */
const protectPartner = async (req, res, next) => {
  try {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer '))
      return next(new AppError('Not authorised', 401))
    const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET)
    const user = await User.findById(decoded.id).select('-password')
    if (!user) return next(new AppError('User not found', 401))
    req.user = user
    next()
  } catch {
    next(new AppError('Not authorised — invalid token', 401))
  }
}

/* ─── PUBLIC: Register partner + create login account ─────────────────────── */
// POST /api/partners
router.post('/', asyncHandler(async (req, res, next) => {
  const {
    companyName, contactName, email, mobile, website,
    city, state, foundedYear, teamSize,
    categories, productName, tagline, description,
    pricing, integrations, whyPartner,
    password,
  } = req.body

  if (!companyName || !contactName || !email || !mobile || !productName) {
    return next(new AppError('Required fields missing', 400))
  }
  if (!password || password.length < 6) {
    return next(new AppError('Password must be at least 6 characters', 400))
  }

  // Check if email already registered
  const existingUser = await User.findOne({ email })
  if (existingUser) return next(new AppError('Email already registered. Please login.', 409))

  const existingPartner = await Partner.findOne({ email })
  if (existingPartner) return next(new AppError('A partner application with this email already exists.', 409))

  // Create the User account with role = 'partner'
  const user = await User.create({
    name:     companyName,
    email,
    password,
    phone:    mobile,
    role:     'partner',
  })

  // Create the Partner record linked to the user
  const partner = await Partner.create({
    userId:       user._id,
    companyName, contactName, email, mobile, website,
    city, state, foundedYear, teamSize,
    categories:   Array.isArray(categories) ? categories : [],
    productName, tagline, description, pricing, integrations, whyPartner,
  })

  // Return token so partner is immediately logged in after registration
  const token = signToken(user._id)

  res.status(201).json({
    success: true,
    message: 'Application submitted and account created successfully',
    token,
    partner: {
      _id:         partner._id,
      companyName: partner.companyName,
      productName: partner.productName,
      status:      partner.status,
      email:       partner.email,
    },
  })
}))

/* ─── PUBLIC: Partner login ────────────────────────────────────────────────── */
// POST /api/partners/login
router.post('/login', asyncHandler(async (req, res, next) => {
  const { email, password } = req.body
  if (!email || !password) return next(new AppError('Email and password are required', 400))

  const user = await User.findOne({ email, role: 'partner' }).select('+password')
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid email or password', 401))
  }
  if (!user.isActive) return next(new AppError('Account is deactivated. Contact support.', 403))

  const partner = await Partner.findOne({ userId: user._id })
  if (!partner) return next(new AppError('Partner profile not found', 404))

  const token = signToken(user._id)

  res.json({
    success: true,
    token,
    partner: {
      _id:         partner._id,
      companyName: partner.companyName,
      productName: partner.productName,
      status:      partner.status,
      email:       partner.email,
      categories:  partner.categories,
    },
  })
}))

/* ─── PARTNER: Get own dashboard data ─────────────────────────────────────── */
// GET /api/partners/dashboard
router.get('/dashboard', protectPartner, asyncHandler(async (req, res, next) => {
  const partner = await Partner.findOne({ userId: req.user._id })
  if (!partner) return next(new AppError('Partner profile not found', 404))

  // Leads stats
  const leads = await PartnerLead.find({ partnerId: partner._id }).sort({ createdAt: -1 })

  const totalLeads   = leads.length
  const newLeads     = leads.filter(l => l.status === 'new').length
  const converted    = leads.filter(l => l.status === 'converted').length
  const recentLeads  = leads.slice(0, 10)

  // Monthly leads (last 6 months)
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const monthly = await PartnerLead.aggregate([
    { $match: { partnerId: partner._id, createdAt: { $gte: sixMonthsAgo } } },
    { $group: {
      _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
      count: { $sum: 1 },
    }},
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ])

  res.json({
    success: true,
    data: {
      partner: {
        _id:         partner._id,
        companyName: partner.companyName,
        productName: partner.productName,
        status:      partner.status,
        email:       partner.email,
        website:     partner.website,
        categories:  partner.categories,
        tagline:     partner.tagline,
        createdAt:   partner.createdAt,
        approvedAt:  partner.approvedAt,
      },
      stats: { totalLeads, newLeads, converted },
      recentLeads,
      monthlyLeads: monthly,
    },
  })
}))

/* ─── PARTNER: Get own leads (paginated) ──────────────────────────────────── */
// GET /api/partners/leads
router.get('/leads', protectPartner, asyncHandler(async (req, res, next) => {
  const partner = await Partner.findOne({ userId: req.user._id })
  if (!partner) return next(new AppError('Partner profile not found', 404))

  const { page = 1, limit = 20, status } = req.query
  const filter = { partnerId: partner._id }
  if (status) filter.status = status

  const skip = (Number(page) - 1) * Number(limit)
  const [leads, total] = await Promise.all([
    PartnerLead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    PartnerLead.countDocuments(filter),
  ])

  res.json({ success: true, total, data: leads })
}))

/* ─── PUBLIC: Track a lead click from marketplace ─────────────────────────── */
// POST /api/partners/:id/lead
router.post('/:id/lead', asyncHandler(async (req, res, next) => {
  const partner = await Partner.findById(req.params.id)
  if (!partner) return next(new AppError('Partner not found', 404))

  const { name, email, mobile, company, message, source, category } = req.body

  const lead = await PartnerLead.create({
    partnerId: partner._id,
    name, email, mobile, company, message,
    source: source || 'marketplace',
    category: category || (partner.categories[0] || ''),
  })

  res.status(201).json({ success: true, message: 'Lead recorded', data: lead })
}))

/* ─── ADMIN: List all partners ─────────────────────────────────────────────── */
router.get('/', protect, restrictTo('admin'), asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const filter = {}
  if (status) filter.status = status

  const skip = (Number(page) - 1) * Number(limit)
  const [partners, total] = await Promise.all([
    Partner.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Partner.countDocuments(filter),
  ])
  res.json({ success: true, total, data: partners })
}))

/* ─── ADMIN: Get one partner ───────────────────────────────────────────────── */
router.get('/:id', protect, restrictTo('admin'), asyncHandler(async (req, res, next) => {
  const partner = await Partner.findById(req.params.id)
  if (!partner) return next(new AppError('Partner not found', 404))
  res.json({ success: true, data: partner })
}))

/* ─── ADMIN: Update status / notes ────────────────────────────────────────── */
router.patch('/:id', protect, restrictTo('admin'), asyncHandler(async (req, res, next) => {
  const { status, adminNotes } = req.body
  const update = {}
  if (status)     update.status     = status
  if (adminNotes !== undefined) update.adminNotes = adminNotes
  if (status === 'approved' || status === 'active') update.approvedAt = new Date()

  const partner = await Partner.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
  if (!partner) return next(new AppError('Partner not found', 404))
  res.json({ success: true, data: partner })
}))

/* ─── PUBLIC: Approved partners for marketplace ────────────────────────────── */
router.get('/public/approved', asyncHandler(async (req, res) => {
  const partners = await Partner.find(
    { status: { $in: ['approved', 'active'] } },
    { companyName:1, productName:1, tagline:1, description:1, categories:1, website:1, pricing:1 }
  ).sort({ approvedAt: -1 })
  res.json({ success: true, data: partners })
}))

module.exports = router
