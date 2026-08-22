const FAQ    = require('../models/FAQ')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

// GET /api/faqs?category=GST&serviceSlug=gst-registration
exports.getAllFAQs = asyncHandler(async (req, res) => {
  const { category, serviceSlug } = req.query
  const filter = { isActive: true }
  if (category)    filter.category = category
  if (serviceSlug) filter.serviceSlug = serviceSlug

  const faqs = await FAQ.find(filter).sort({ sortOrder: 1, createdAt: 1 })
  res.json({ success: true, count: faqs.length, data: faqs })
})

// POST /api/faqs  (admin)
exports.createFAQ = asyncHandler(async (req, res) => {
  const faq = await FAQ.create(req.body)
  res.status(201).json({ success: true, data: faq })
})

// PUT /api/faqs/:id  (admin)
exports.updateFAQ = asyncHandler(async (req, res, next) => {
  const faq = await FAQ.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
  if (!faq) return next(new AppError('FAQ not found', 404))
  res.json({ success: true, data: faq })
})

// DELETE /api/faqs/:id  (admin)
exports.deleteFAQ = asyncHandler(async (req, res, next) => {
  const faq = await FAQ.findByIdAndDelete(req.params.id)
  if (!faq) return next(new AppError('FAQ not found', 404))
  res.json({ success: true, message: 'FAQ deleted' })
})
