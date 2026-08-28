const Contact      = require('../models/Contact')
const Lead         = require('../models/Lead')
const { sendEmail, contactAckEmail, contactNotifyEmail } = require('../config/email')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

// POST /api/contact
exports.submitContact = asyncHandler(async (req, res, next) => {
  const { name, mobile, email, state, message, whatsappOptin, source, service } = req.body

  if (!name || !mobile) {
    return next(new AppError('Name and mobile are required', 400))
  }
  // Provide defaults for optional fields so MongoDB validation passes
  const safeEmail = email || `noemail_${Date.now()}@launcherdesk.internal`
  const safeState = state || 'Not specified'

  // Save contact enquiry
  const contact = await Contact.create({
    name, mobile, email: safeEmail, state: safeState, message, whatsappOptin, source, service
  })

  // Also create a Lead record so it appears in the Leads admin panel
  try {
    await Lead.create({
      name,
      email:           safeEmail,
      mobile,
      state:           safeState,
      message,
      source:          source || 'contact-page',
      serviceInterest: service || undefined,
      status:          'new',
    })
  } catch (leadErr) {
    // Non-blocking — lead creation failure should not fail the contact submission
    console.error('Lead mirror error:', leadErr.message)
  }

  // Fire-and-forget emails — don't block the response
  Promise.all([
    ...(email && !safeEmail.includes('noemail_') ? [sendEmail({ to: email, ...contactAckEmail(name) })] : []),
    ...(process.env.SUPPORT_EMAIL ? [sendEmail({ to: process.env.SUPPORT_EMAIL, ...contactNotifyEmail({ name, mobile, email: safeEmail, state: safeState, message, whatsappOptin, source }) })] : []),
  ]).catch(err => console.error('Email error:', err))

  res.status(201).json({ success: true, message: 'Enquiry received. An expert will reach out shortly.', data: { id: contact._id } })
})

// GET /api/contact  (admin)
exports.getAllContacts = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const filter = status ? { status } : {}
  const skip = (Number(page) - 1) * Number(limit)

  const [contacts, total] = await Promise.all([
    Contact.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Contact.countDocuments(filter),
  ])

  res.json({ success: true, total, page: Number(page), data: contacts })
})

// PATCH /api/contact/:id  (admin — update status / notes)
exports.updateContact = asyncHandler(async (req, res, next) => {
  const contact = await Contact.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
  if (!contact) return next(new AppError('Contact not found', 404))
  res.json({ success: true, data: contact })
})