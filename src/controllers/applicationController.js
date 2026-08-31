const Application = require('../models/Application')
const multer      = require('multer')
const path        = require('path')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { sendEmail, applicationNotifyEmail, applicationAckEmail } = require('../config/email')

// Warn at startup if critical env vars are missing
if (!process.env.BREVO_API_KEY)   console.warn('[WARN] BREVO_API_KEY is not set — emails will fail')
if (!process.env.EMAIL_FROM_ADDR) console.warn('[WARN] EMAIL_FROM_ADDR is not set — emails will fall back to noreply@launcherdesk.in')

// ── Multer — memory storage (file stays as Buffer, attached to email directly)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    ;['.pdf', '.doc', '.docx'].includes(ext)
      ? cb(null, true)
      : cb(new Error('Only PDF, DOC or DOCX files are accepted for resumes'))
  },
})
exports.uploadResume = upload.single('resume')

// ── POST /api/applications ────────────────────────────────────────────────
exports.submitApplication = asyncHandler(async (req, res, next) => {
  const {
    firstName, lastName, email, phone, city,
    role, experience, education, currentCompany,
    linkedIn, coverLetter,
  } = req.body

  console.log('[Application] Received submission:', { firstName, lastName, email, role })

  // Validate required fields
  if (!firstName || !lastName || !email || !phone) {
    return next(new AppError('First name, last name, email and phone are required', 400))
  }

  const hasResume  = !!req.file
  const resumeName = hasResume ? req.file.originalname : null

  // Save to MongoDB
  await Application.create({
    name:    `${firstName} ${lastName}`,
    email,
    mobile:  phone,
    role:    role || 'General',
    message: coverLetter || '',
  })
  console.log('[Application] Saved to DB ✓')

  // Build email data
  const emailData = {
    firstName, lastName, email, phone, city,
    role: role || 'General',
    experience, education, currentCompany,
    linkedIn, coverLetter, resumeName,
  }

  // Build attachment array if resume uploaded
  const attachments = hasResume
    ? [{ filename: req.file.originalname, content: req.file.buffer, contentType: req.file.mimetype }]
    : []

  // ── Send Email 1: Full application → hr@launcherdesk.com
  //    fromEmail must be a Brevo-verified sender address
  try {
    await sendEmail({
      to:        'hr@launcherdesk.com',
      fromName:  `${firstName} ${lastName} via LauncherDesk`,
      fromEmail: process.env.EMAIL_FROM_ADDR || 'noreply@launcherdesk.in',
      subject:   applicationNotifyEmail(emailData).subject,
      html:      applicationNotifyEmail(emailData).html,
      attachments,
    })
    console.log('[Application] HR notification sent to hr@launcherdesk.com ✓')
  } catch (err) {
    console.error('[Application] HR email FAILED:', err?.response?.data || err.message)
    // Don't block — still send ack and return success to user
  }

  // ── Send Email 2: Acknowledgement → applicant
  try {
    await sendEmail({
      to:        email,
      fromName:  'LauncherDesk Careers',
      fromEmail: process.env.EMAIL_FROM_ADDR || 'noreply@launcherdesk.in',
      subject:   applicationAckEmail(firstName, role || 'General').subject,
      html:      applicationAckEmail(firstName, role || 'General').html,
    })
    console.log(`[Application] Acknowledgement sent to ${email} ✓`)
  } catch (err) {
    console.error('[Application] Ack email FAILED:', err?.response?.data || err.message)
  }

  res.status(201).json({
    success: true,
    message: "Application received — we'll review it and be in touch within 3–5 business days!",
  })
})

// ── GET /api/applications  (admin only)
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

// ── PATCH /api/applications/:id  (admin only)
exports.updateApplication = asyncHandler(async (req, res, next) => {
  const app = await Application.findByIdAndUpdate(req.params.id, req.body, { new: true })
  if (!app) return next(new AppError('Application not found', 404))
  res.json({ success: true, data: app })
})