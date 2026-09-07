const { body, validationResult } = require('express-validator')

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Please check the highlighted fields.',
      fields: errors.array().reduce((acc, e) => { acc[e.path] = e.msg; return acc }, {}),
    })
  }
  next()
}

const nameValidator = body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 120 }).withMessage('Name must be under 120 characters').escape()
const emailValidator = body('email').trim().normalizeEmail().isEmail().withMessage('A valid email address is required')
const mobileValidator = body('mobile').trim().notEmpty().withMessage('Mobile number is required').matches(/^\+?[0-9\s\-()\u00B7]{10,15}$/).withMessage('Please enter a valid mobile number')
const optionalMobileValidator = body('mobile').optional({ nullable: true, checkFalsy: true }).trim().matches(/^\+?[0-9\s\-()\u00B7]{10,15}$/).withMessage('Please enter a valid mobile number')
const passwordValidator = body('password').isLength({ min: 6, max: 128 }).withMessage('Password must be between 6 and 128 characters')
const messageValidator = body('message').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 2000 }).withMessage('Message must be under 2000 characters')

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra',
  'Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim',
  'Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu',
  'Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry','Not specified',
]

const contactValidators = [
  nameValidator,
  mobileValidator,
  body('email').optional({ nullable: true, checkFalsy: true }).trim().normalizeEmail().isEmail().withMessage('Please enter a valid email address'),
  body('state').optional().trim().isLength({ max: 80 }),
  messageValidator,
  body('source').optional().trim().isLength({ max: 80 }),
  body('service').optional().trim().isLength({ max: 100 }),
  body('whatsappOptin').optional().isBoolean(),
]

const quoteValidators = [
  nameValidator,
  emailValidator,
  mobileValidator,
  body('state').trim().notEmpty().withMessage('State is required').isIn(INDIAN_STATES).withMessage('Please select a valid state'),
  body('serviceSlug').trim().notEmpty().withMessage('Service is required').isLength({ max: 100 }),
  body('serviceTitle').optional().trim().isLength({ max: 200 }),
  body('businessType').optional().trim().isLength({ max: 100 }),
  body('additionalInfo').optional().trim().isLength({ max: 2000 }),
]

const leadValidators = [
  nameValidator,
  emailValidator,
  optionalMobileValidator,
  body('source').optional().trim().isLength({ max: 80 }),
  body('serviceInterest').optional().trim().isLength({ max: 200 }),
  messageValidator,
]

const registerValidators = [
  nameValidator,
  emailValidator,
  passwordValidator,
  body('phone').optional().trim().matches(/^\+?[0-9\s\-()\u00B7]{10,15}$/).withMessage('Please enter a valid phone number'),
]

const loginValidators = [
  emailValidator,
  body('password').notEmpty().withMessage('Password is required').isLength({ max: 128 }),
]

module.exports = {
  validate,
  nameValidator, emailValidator, mobileValidator, passwordValidator, messageValidator,
  contactValidators, quoteValidators, leadValidators, registerValidators, loginValidators,
}
