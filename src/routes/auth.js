const router = require('express').Router()
const { register, login, getMe } = require('../controllers/authController')
const { protect } = require('../middleware/auth')
const { registerValidators, loginValidators, validate } = require('../middleware/validate')

router.post('/register', registerValidators, validate, register)
router.post('/login',    loginValidators,    validate, login)
router.get('/me',        protect, getMe)

module.exports = router