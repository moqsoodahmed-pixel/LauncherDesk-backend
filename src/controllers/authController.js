const jwt          = require('jsonwebtoken')
const User         = require('../models/User')
const { AppError, asyncHandler } = require('../middleware/errorHandler')

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' })

const sendTokenResponse = (user, statusCode, res) => {
  const token = signToken(user._id)
  res.status(statusCode).json({
    success: true,
    token,
    user: {
      _id:   user._id,
      name:  user.name,
      email: user.email,
      role:  user.role,
    },
  })
}

// POST /api/auth/register
exports.register = asyncHandler(async (req, res, next) => {
  const { name, email, password, phone } = req.body
  if (!name || !email || !password) return next(new AppError('Name, email and password are required', 400))

  const existing = await User.findOne({ email })
  if (existing) return next(new AppError('Email already registered', 409))

  const user = await User.create({ name, email, password, phone })
  sendTokenResponse(user, 201, res)
})

// POST /api/auth/login
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body
  if (!email || !password) return next(new AppError('Email and password are required', 400))

  const user = await User.findOne({ email }).select('+password')
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid email or password', 401))
  }
  if (!user.isActive) return next(new AppError('Account is deactivated', 403))

  sendTokenResponse(user, 200, res)
})

// GET /api/auth/me  (protected)
exports.getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user })
})
