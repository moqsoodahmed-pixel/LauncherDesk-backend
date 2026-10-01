const router = require('express').Router()
const { getConfig, createOrder, verifyPayment } = require('../controllers/paymentController')
// NOTE: POST /api/payments/webhook is mounted directly in server.js (it needs the raw body).
const { protect } = require('../middleware/auth')

router.get('/config', getConfig)
router.post('/create-order', protect, createOrder)
router.post('/verify',       protect, verifyPayment)

module.exports = router
