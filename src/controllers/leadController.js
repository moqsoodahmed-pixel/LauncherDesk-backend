const Lead   = require('../models/Lead')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

// POST /api/leads  (from AI page / service finder / newsletter)
exports.createLead = asyncHandler(async (req, res, next) => {
  const { name, email } = req.body
  if (!name || !email) return next(new AppError('Name and email are required', 400))
  const lead = await Lead.create(req.body)
  res.status(201).json({ success: true, data: { id: lead._id } })
})

// GET /api/leads  (admin)
exports.getAllLeads = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 25 } = req.query
  const filter = status ? { status } : {}
  const skip   = (Number(page) - 1) * Number(limit)

  const [leads, total] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).populate('assignedTo', 'name email'),
    Lead.countDocuments(filter),
  ])
  res.json({ success: true, total, page: Number(page), data: leads })
})

// PATCH /api/leads/:id  (admin)
exports.updateLead = asyncHandler(async (req, res, next) => {
  const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
  if (!lead) return next(new AppError('Lead not found', 404))
  res.json({ success: true, data: lead })
})
