const router = require('express').Router()
const { getConfig, createOrder, verifyPayment, createCheckoutOrder, createTrademarkOrder, createEStampOrder, verifyCheckoutPayment } = require('../controllers/paymentController')
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
// e-Stamp paper — login required; price worked out on the server (config/planPrices.js → ESTAMP)
// (no .escape() here: the values are stored as typed and escaped wherever they are displayed)
const txt = (f, max, msg) => body(f).trim().notEmpty().withMessage(msg).isLength({ max }).withMessage(`${msg} (max ${max} characters)`)
router.post('/checkout/estamp/create-order', protect, [
  body('state').trim().notEmpty().withMessage('State is required'),
  body('stateName').optional().trim().isLength({ max: 60 }),
  txt('firstParty', 150, 'First party name is required'),
  txt('secondParty', 150, 'Second party name is required (write NIL if none)'),
  body('payer').trim().isIn(['First Party', 'Second Party']).withMessage('Select who pays the stamp duty'),
  txt('documentType', 80, 'Document type is required'),
  txt('purpose', 500, 'Purpose is required'),
  body('stampDuty').isInt({ min: 1, max: 100000 }).withMessage('Choose a valid stamp duty value').toInt(),
  body('consideration').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 1e12 }).withMessage('Enter a valid consideration amount'),
  body('printDocument').optional().isBoolean().toBoolean(),
  body('delivery').trim().isIn(['email', 'courier']).withMessage('Choose a delivery option'),
  nameValidator,
  emailValidator,
  mobileValidator,
  body('address').if(body('delivery').equals('courier')).trim().notEmpty().withMessage('Delivery address is required').isLength({ max: 300 }),
  body('city').if(body('delivery').equals('courier')).trim().notEmpty().withMessage('City is required').isLength({ max: 80 }),
  body('pincode').if(body('delivery').equals('courier')).trim().matches(/^\d{6}$/).withMessage('Enter a 6-digit PIN code'),
], validate, createEStampOrder)

router.post('/checkout/verify', verifyCheckoutPayment)

module.exports = router