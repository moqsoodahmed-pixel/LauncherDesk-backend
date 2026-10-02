const router = require('express').Router()
const { getConfig, createOrder, verifyPayment, createCheckoutOrder, createTrademarkOrder, verifyCheckoutPayment } = require('../controllers/paymentController')
const { body } = require('express-validator')
const { APPLICANT_TYPES, TRADEMARK } = require('../config/planPrices')
const { validate, nameValidator, emailValidator, mobileValidator } = require('../middleware/validate')
// NOTE: POST /api/payments/webhook is mounted directly in server.js (it needs the raw body).
const { protect } = require('../middleware/auth')

router.get('/config', getConfig)
router.post('/create-order', protect, createOrder)
router.post('/verify',       protect, verifyPayment)

// Guest checkout — no login. Price is calculated on the server from serviceSlug + tier.
router.post('/checkout/create-order', [
  body('serviceSlug').trim().notEmpty().isLength({ max: 100 }).withMessage('Service is required'),
  body('tier').trim().isIn(['Basic', 'Standard', 'Premium']).withMessage('Please choose a plan'),
  nameValidator,
  emailValidator,
  mobileValidator,
  body('city').trim().notEmpty().withMessage('City is required').isLength({ max: 80 }).withMessage('City must be under 80 characters').escape(),
  body('whatsappOptIn').optional().isBoolean(),
], validate, createCheckoutOrder)
router.post('/checkout/trademark/create-order', [
  nameValidator,
  emailValidator,
  mobileValidator,
  body('city').trim().notEmpty().withMessage('City is required').isLength({ max: 80 }).withMessage('City must be under 80 characters').escape(),
  body('applicantType').trim().isIn(APPLICANT_TYPES).withMessage('Please choose an applicant type'),
  body('classes').isInt({ min: 1, max: TRADEMARK.maxClasses }).withMessage(`Choose between 1 and ${TRADEMARK.maxClasses} classes`).toInt(),
  body('brandName').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 120 }).withMessage('Brand name must be under 120 characters').escape(),
  body('whatsappOptIn').optional().isBoolean(),
], validate, createTrademarkOrder)
router.post('/checkout/verify', verifyCheckoutPayment)

module.exports = router