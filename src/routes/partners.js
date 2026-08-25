const router  = require('express').Router()
const Partner = require('../models/Partner')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { protect, restrictTo }    = require('../middleware/auth')

/* ── Public: submit partner application ── */
router.post('/', asyncHandler(async (req, res) => {
  const {
    companyName, contactName, email, mobile, website,
    city, state, foundedYear, teamSize,
    categories, productName, tagline, description,
    pricing, integrations, whyPartner,
  } = req.body

  if (!companyName || !contactName || !email || !mobile || !productName) {
    throw new AppError('Required fields missing', 400)
  }

  const partner = await Partner.create({
    companyName, contactName, email, mobile, website,
    city, state, foundedYear, teamSize,
    categories: Array.isArray(categories) ? categories : [],
    productName, tagline, description, pricing, integrations, whyPartner,
  })

  res.status(201).json({ success: true, message: 'Application submitted successfully', data: partner })
}))

/* ── Admin: list all partners ── */
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

/* ── Admin: get one partner ── */
router.get('/:id', protect, restrictTo('admin'), asyncHandler(async (req, res, next) => {
  const partner = await Partner.findById(req.params.id)
  if (!partner) return next(new AppError('Partner not found', 404))
  res.json({ success: true, data: partner })
}))

/* ── Admin: update status / notes ── */
router.patch('/:id', protect, restrictTo('admin'), asyncHandler(async (req, res, next) => {
  const { status, adminNotes } = req.body
  const update = {}
  if (status)     update.status     = status
  if (adminNotes) update.adminNotes = adminNotes
  if (status === 'approved') update.approvedAt = new Date()

  const partner = await Partner.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
  if (!partner) return next(new AppError('Partner not found', 404))
  res.json({ success: true, data: partner })
}))

/* ── Public: list approved/active partners (for marketplace) ── */
router.get('/public/approved', asyncHandler(async (req, res) => {
  const partners = await Partner.find(
    { status: { $in: ['approved', 'active'] } },
    { companyName:1, productName:1, tagline:1, description:1, categories:1, website:1, pricing:1 }
  ).sort({ approvedAt: -1 })
  res.json({ success: true, data: partners })
}))

module.exports = router