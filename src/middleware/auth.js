const jwt  = require('jsonwebtoken')
const User = require('../models/User')
const { AppError } = require('./errorHandler')

/**
 * Protect routes — requires a valid Bearer token in Authorization header.
 */
const protect = async (req, res, next) => {
  try {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      return next(new AppError('Not authorised — no token provided', 401))
    }
    const token = auth.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = await User.findById(decoded.id).select('-password')
    if (!req.user) return next(new AppError('User not found', 401))
    next()
  } catch {
    next(new AppError('Not authorised — invalid token', 401))
  }
}

/**
 * Restrict access to specific roles.
 * Usage: router.delete('/...', protect, restrictTo('admin'), handler)
 */
const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(new AppError('You do not have permission to perform this action', 403))
  }
  next()
}

module.exports = { protect, restrictTo }
