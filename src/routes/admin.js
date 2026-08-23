const router  = require('express').Router()
const Contact = require('../models/Contact')
const Lead    = require('../models/Lead')
const Quote   = require('../models/Quote')
const Application = require('../models/Application')
const { protect, restrictTo } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')

// All admin routes require auth + admin role
router.use(protect, restrictTo('admin'))

/**
 * GET /api/admin/stats
 * Returns aggregate counts for the dashboard.
 */
router.get('/stats', asyncHandler(async (_req, res) => {
  const [contacts, leads, quotes, applications] = await Promise.all([
    Contact.countDocuments(),
    Lead.countDocuments(),
    Quote.countDocuments(),
    Application.countDocuments(),
  ])

  // Status breakdowns
  const [contactsByStatus, leadsByStatus, quotesByStatus, appsByStatus] = await Promise.all([
    Contact.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Lead.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Quote.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Application.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ])

  // Monthly contact volume (last 12 months)
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

  const monthlyContacts = await Contact.aggregate([
    { $match: { createdAt: { $gte: twelveMonthsAgo } } },
    { $group: {
      _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
      count: { $sum: 1 },
    }},
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ])

  res.json({
    success: true,
    data: {
      totals: { contacts, leads, quotes, applications },
      contactsByStatus:  Object.fromEntries(contactsByStatus.map(s  => [s._id, s.count])),
      leadsByStatus:     Object.fromEntries(leadsByStatus.map(s     => [s._id, s.count])),
      quotesByStatus:    Object.fromEntries(quotesByStatus.map(s    => [s._id, s.count])),
      applicationsByStatus: Object.fromEntries(appsByStatus.map(s  => [s._id, s.count])),
      monthlyContacts,
    },
  })
}))

/**
 * GET /api/admin/recent
 * Returns the 5 most recent records of each type.
 */
router.get('/recent', asyncHandler(async (_req, res) => {
  const [contacts, leads, quotes, applications] = await Promise.all([
    Contact.find().sort({ createdAt: -1 }).limit(5),
    Lead.find().sort({ createdAt: -1 }).limit(5),
    Quote.find().sort({ createdAt: -1 }).limit(5),
    Application.find().sort({ createdAt: -1 }).limit(5),
  ])
  res.json({ success: true, data: { contacts, leads, quotes, applications } })
}))

module.exports = router
