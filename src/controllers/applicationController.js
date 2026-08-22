const Application = require('../models/Application')
const multer      = require('multer')
const path        = require('path')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

// Multer storage for resumes
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads/resumes')),
  filename:    (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '-')}`),
})
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf|doc|docx/
    allowed.test(path.extname(file.originalname).toLowerCase())
      ? cb(null, true)
      : cb(new Error('Only PDF and Word documents allowed for resume'))
  },
})
exports.uploadResume = upload.single('resume')

// POST /api/applications
exports.submitApplication = asyncHandler(async (req, res, next) => {
  const { name, email, mobile, role, message } = req.body
  if (!name || !email || !mobile) return next(new AppError('Name, email and mobile are required', 400))

  const resumeUrl = req.file ? `/uploads/resumes/${req.file.filename}` : undefined
  const app       = await Application.create({ name, email, mobile, role, message, resumeUrl })

  res.status(201).json({ success: true, message: "Application received — we'll be in touch!", data: { id: app._id } })
})

// GET /api/applications  (admin)
exports.getAllApplications = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const filter = status ? { status } : {}
  const skip   = (Number(page) - 1) * Number(limit)

  const [apps, total] = await Promise.all([
    Application.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Application.countDocuments(filter),
  ])
  res.json({ success: true, total, page: Number(page), data: apps })
})

// PATCH /api/applications/:id  (admin)
exports.updateApplication = asyncHandler(async (req, res, next) => {
  const app = await Application.findByIdAndUpdate(req.params.id, req.body, { new: true })
  if (!app) return next(new AppError('Application not found', 404))
  res.json({ success: true, data: app })
})
