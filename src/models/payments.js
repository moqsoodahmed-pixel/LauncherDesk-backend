const router = require('express').Router()
const { createOrder, verifyPayment } = require('../controllers/paymentController')
const { protect } = require('../middleware/auth')

// Both routes require user to be logged in
router.post('/create-order', protect, createOrder)
router.post('/verify',       protect, verifyPayment)

module.exports = router