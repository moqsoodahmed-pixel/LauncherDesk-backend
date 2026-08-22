const Quote        = require('../models/Quote')
const { sendEmail, quoteNotifyEmail } = require('../config/email')
const { asyncHandler, AppError }      = require('../middleware/errorHandler')

// POST /api/quotes
exports.submitQuote = asyncHandler(async (req, res, next) => {
  const { name, email, mobile, state, serviceSlug, serviceTitle, businessType, additionalInfo } = req.body

  if (!name || !email || !mobile || !state || !serviceSlug) {
    return next(new AppError('Name, email, mobile, state and serviceSlug are required', 400))
  }

  const quote = await Quote.create({ name, email, mobile, state, serviceSlug, serviceTitle, businessType, additionalInfo })

  sendEmail({ to: process.env.SUPPORT_EMAIL, ...quoteNotifyEmail({ name, email, mobile, state, serviceSlug, serviceTitle, businessType, additionalInfo }) })
    .catch(err => console.error('Email error:', err))

  res.status(201).json({ success: true, message: "Quote request received. We'll be in touch shortly.", data: { id: quote._id } })
})

// GET /api/quotes  (admin)
exports.getAllQuotes = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const filter = status ? { status } : {}
  const skip   = (Number(page) - 1) * Number(limit)

  const [quotes, total] = await Promise.all([
    Quote.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Quote.countDocuments(filter),
  ])

  res.json({ success: true, total, page: Number(page), data: quotes })
})

// PATCH /api/quotes/:id  (admin)
exports.updateQuote = asyncHandler(async (req, res, next) => {
  const quote = await Quote.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
  if (!quote) return next(new AppError('Quote not found', 404))
  res.json({ success: true, data: quote })
})
