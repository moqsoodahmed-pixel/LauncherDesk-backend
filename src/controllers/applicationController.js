const Application = require('../models/Application')
const multer      = require('multer')
const path        = require('path')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { sendEmail, applicationNotifyEmail, applicationAckEmail } = require('../config/email')

// ── Use memoryStorage so the file is available as a Buffer in req.file.buffer
//    This means we can attach it directly to the email without relying on
//    Railway's ephemeral filesystem (files there disappear on every redeploy).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (['.pdf', '.doc', '.docx'].includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error('Only PDF, DOC or DOCX files are accepted for resumes'))
    }
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

  const hasResume  = !!req.file
  const resumeName = hasResume ? req.file.originalname : null

  // Save to DB (no resumeUrl stored since we use memoryStorage)
  await Application.create({
    name:    `${firstName} ${lastName}`,
    email,
    mobile:  phone,
    role:    role || 'General',
    message: coverLetter || '',
  })

  // Build data object for email templates
  const emailData = {
    firstName, lastName, email, phone, city,
    role: role || 'General',
    experience, education, currentCompany,
    linkedIn, coverLetter,
    resumeName, // shown in email body
  }

  // Build nodemailer attachment if resume was uploaded
  const attachments = hasResume
    ? [{
        filename:    req.file.originalname,
        content:     req.file.buffer,       // Buffer from memoryStorage
        contentType: req.file.mimetype,
      }]
    : []

  // Send emails (fire-and-forget — never block the HTTP response)
  Promise.all([
    // 1. Full application details + resume attached → HR inbox
    sendEmail({
      to:          'hr@launcherdesk.com',
      subject:     applicationNotifyEmail(emailData).subject,
      html:        applicationNotifyEmail(emailData).html,
      attachments, // resume file attached here
    }),
    // 2. Acknowledgement → applicant's inbox (no attachment needed)
    sendEmail({
      to:      email,
      subject: applicationAckEmail(firstName, role || 'General').subject,
      html:    applicationAckEmail(firstName, role || 'General').html,
    }),
  ]).catch(err => console.error('[Application email error]', err.message))

  res.status(201).json({
    success: true,
    message: "Application received — we'll review it and be in touch within 3–5 business days!",
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