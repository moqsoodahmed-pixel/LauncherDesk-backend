const router = require('express').Router()
const { getConfig, createOrder, verifyPayment } = require('../controllers/paymentController')
const { protect } = require('../middleware/auth')

router.get('/config', getConfig)
router.post('/create-order', protect, createOrder)
router.post('/verify',       protect, verifyPayment)

module.exports = router
