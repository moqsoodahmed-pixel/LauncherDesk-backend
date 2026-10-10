const jwt  = require('jsonwebtoken')
const crypto = require('crypto')
const User = require('../models/User')
const { AppError } = require('./errorHandler')

// The site now has two separate login systems:
//  - the original one (this file), used by the consumer site's own account model
//  - "Portal" (services/portal/token.service.js), a newer unified login for
//    Client/Admin/Super Admin, with its own account model (models/portal/User.model.js,
//    collection "portal_users") and short-lived (15 min) access tokens.
// A customer who only ever logged in through Portal has no token this file
// understands, so every old customer-facing route (e-stamp, dashboard, invoices...)
// would see them as logged out. To fix that without moving those routes, a valid
// Portal access token is also accepted here: we look up (or create, on first use)
// the matching account in THIS system by email, so both logins reach the same
// customer record and nothing elsewhere in the app has to change.
let portalVerify = null
function getPortalVerify() {
  if (portalVerify === null) {
    try { portalVerify = require('../services/portal/token.service').verifyAccessToken }
    catch { portalVerify = false /* Portal not present in this deployment */ }
  }
  return portalVerify || null
}

async function userFromPortalToken(token) {
  const verify = getPortalVerify()
  if (!verify) return null
  const decoded = verify(token) // throws if invalid/expired — caller catches
  const { PortalUser } = (() => { try { return { PortalUser: require('../models/portal').User } } catch { return {} } })()
  if (!PortalUser) return null
  const portalUser = await PortalUser.findById(decoded.sub)
  if (!portalUser || portalUser.status !== 'active') return null
  if ((decoded.tv ?? 0) !== (portalUser.tokenVersion ?? 0)) return null // logged out / password changed since this token was issued

  const email = String(portalUser.email || '').toLowerCase().trim()
  if (!email) return null
  let bridged = await User.findOne({ email })
  if (!bridged) {
    bridged = await User.create({
      name: portalUser.name || email.split('@')[0],
      email,
      phone: portalUser.phone,
      password: crypto.randomBytes(24).toString('hex'), // never used to log in — identity comes from the Portal token
      role: 'user',
      emailVerified: true,
      authProvider: 'portal',
    })
  }
  return bridged
}

/**
 * Protect routes — requires a valid Bearer token in Authorization header.
 * Accepts either this site's own token or a Portal access token (see above).
 */
const protect = async (req, res, next) => {
  try {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      return next(new AppError('Not authorised — no token provided', 401))
    }
    const token = auth.split(' ')[1]

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      req.user = await User.findById(decoded.id).select('-password')
      if (!req.user) return next(new AppError('User not found', 401))
      return next()
    } catch (ownTokenErr) {
      const bridged = await userFromPortalToken(token).catch(() => null)
      if (bridged) { req.user = bridged; return next() }
      throw ownTokenErr
    }
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