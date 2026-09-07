const router       = require('express').Router()
const ServiceOrder = require('../models/ServiceOrder')
const Payment      = require('../models/Payment')
const { protect }  = require('../middleware/auth')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

router.use(protect)

router.get('/dashboard', asyncHandler(async (req, res) => {
  const userId = req.user._id
  const [orders, payments, recentOrders] = await Promise.all([
    ServiceOrder.countDocuments({ user: userId }),
    Payment.countDocuments({ user: userId, status: 'paid' }),
    ServiceOrder.find({ user: userId }).sort({ createdAt: -1 }).limit(5)
      .select('serviceTitle serviceSlug status steps createdAt expectedBy assignedProfessional').lean(),
  ])
  const activeOrders = await ServiceOrder.countDocuments({
    user: userId, status: { $in: ['received', 'in-progress', 'pending-docs', 'processing'] },
  })
  res.json({
    success: true,
    data: {
      stats: { totalOrders: orders, activeOrders, totalPayments: payments },
      recentOrders,
      user: { name: req.user.name, email: req.user.email, phone: req.user.phone },
    },
  })
}))

router.get('/orders', asyncHandler(async (req, res) => {
  const { status } = req.query
  const page  = Math.max(1, parseInt(req.query.page)  || 1)
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10))
  const skip  = (page - 1) * limit
  const filter = { user: req.user._id }
  if (status && status !== 'all') filter.status = status
  const [orders, total] = await Promise.all([
    ServiceOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-adminNotes').lean(),
    ServiceOrder.countDocuments(filter),
  ])
  res.json({ success: true, total, data: orders })
}))

router.get('/orders/:id', asyncHandler(async (req, res, next) => {
  const order = await ServiceOrder.findOne({ _id: req.params.id, user: req.user._id })
    .select('-adminNotes').populate('payment', 'amountRupees status verifiedAt').lean()
  if (!order) return next(new AppError('Order not found', 404))
  res.json({ success: true, data: order })
}))

router.get('/payments', asyncHandler(async (req, res) => {
  const payments = await Payment.find({ user: req.user._id, status: 'paid' })
    .sort({ verifiedAt: -1 }).limit(20)
    .select('serviceTitle serviceSlug amountRupees currency status verifiedAt razorpayPaymentId createdAt').lean()
  res.json({ success: true, data: payments })
}))

router.get('/profile', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: { _id: req.user._id, name: req.user.name, email: req.user.email, phone: req.user.phone, role: req.user.role, createdAt: req.user.createdAt },
  })
}))

module.exports = router
