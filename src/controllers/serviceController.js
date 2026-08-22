const Service = require('../models/Service')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

// GET /api/services
exports.getAllServices = asyncHandler(async (req, res) => {
  const { category, featured } = req.query
  const filter = { isActive: true }
  if (category)         filter.category = category
  if (featured === 'true') filter.isFeatured = true

  const services = await Service.find(filter)
    .select('slug title eyebrow lead category priceFrom isFeatured sortOrder')
    .sort({ sortOrder: 1, title: 1 })

  res.json({ success: true, count: services.length, data: services })
})

// GET /api/services/:slug
exports.getService = asyncHandler(async (req, res, next) => {
  const service = await Service.findOne({ slug: req.params.slug, isActive: true })
  if (!service) return next(new AppError('Service not found', 404))
  res.json({ success: true, data: service })
})

// POST /api/services  (admin)
exports.createService = asyncHandler(async (req, res, next) => {
  const exists = await Service.findOne({ slug: req.body.slug })
  if (exists) return next(new AppError('A service with this slug already exists', 409))
  const service = await Service.create(req.body)
  res.status(201).json({ success: true, data: service })
})

// PUT /api/services/:slug  (admin)
exports.updateService = asyncHandler(async (req, res, next) => {
  const service = await Service.findOneAndUpdate({ slug: req.params.slug }, req.body, { new: true, runValidators: true })
  if (!service) return next(new AppError('Service not found', 404))
  res.json({ success: true, data: service })
})

// DELETE /api/services/:slug  (admin — soft delete)
exports.deleteService = asyncHandler(async (req, res, next) => {
  const service = await Service.findOneAndUpdate({ slug: req.params.slug }, { isActive: false }, { new: true })
  if (!service) return next(new AppError('Service not found', 404))
  res.json({ success: true, message: 'Service deactivated' })
})
