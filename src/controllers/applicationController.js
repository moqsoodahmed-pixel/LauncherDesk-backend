const Application = require('../models/Application')
const multer      = require('multer')
const path        = require('path')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { sendEmail, applicationNotifyEmail, applicationAckEmail } = require('../config/email')

// Multer storage for resumes
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads/resumes')),
  filename:    (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '-')}`),
})
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
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
  const {
    firstName, lastName, email, phone, city,
    role, experience, education, currentCompany,
    linkedIn, coverLetter,
  } = req.body

  if (!firstName || !lastName || !email || !phone) {
    return next(new AppError('First name, last name, email and phone are required', 400))
  }

  const resumeUrl = req.file ? `/uploads/resumes/${req.file.filename}` : undefined

  // Save to DB
  const app = await Application.create({
    name:      `${firstName} ${lastName}`,
    email,
    mobile:    phone,
    role:      role || 'General',
    message:   coverLetter || '',
    resumeUrl,
  })

  // Build email data object
  const emailData = {
    firstName, lastName, email, phone, city,
    role: role || 'General',
    experience, education, currentCompany,
    linkedIn, coverLetter, resumeUrl,
  }

  // Send emails (fire-and-forget — don't block the response)
  Promise.all([
    // Notify HR
    sendEmail({
      to:      'hr@launcherdesk.com',
      subject: applicationNotifyEmail(emailData).subject,
      html:    applicationNotifyEmail(emailData).html,
    }),
    // Acknowledge applicant
    sendEmail({
      to:      email,
      subject: applicationAckEmail(firstName, role || 'General').subject,
      html:    applicationAckEmail(firstName, role || 'General').html,
    }),
  ]).catch(err => console.error('Application email error:', err.message))

  res.status(201).json({
    success: true,
    message: "Application received — we'll review it and be in touch within 3–5 business days!",
    data: { id: app._id },
  })
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