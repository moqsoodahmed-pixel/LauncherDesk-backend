const jwt          = require('jsonwebtoken')
const User         = require('../models/User')
const { AppError, asyncHandler } = require('../middleware/errorHandler')
const { routeForRole } = require('../config/roleRouting')

// Coarse capabilities for LauncherDesk roles (they predate fine-grained permissions);
// returned so the login contract is identical for every role.
const LEGACY_PERMISSIONS = {
  user:    ['customer:dashboard'],
  partner: ['partner:dashboard'],
  sales:   ['sales:dashboard', 'sales:leads', 'sales:quotes'],
  admin:   ['internal-admin:*'],
}

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
      emailVerified: !!user.emailVerified,
    },
  })
}

// POST /api/auth/register
exports.register = asyncHandler(async (req, res, next) => {
  const { name, email, password, phone } = req.body
  if (!name || !email || !password) return next(new AppError('Name, email and password are required', 400))

  const existing = await User.findOne({ email })
  if (existing) return next(new AppError('Email already registered', 409))

  const user = await User.create({ name, email, password, phone, emailVerified: false })
  require('../services/otpService').sendOtp(user).catch(err => console.error('[OTP] send on register failed:', err.message))
  sendTokenResponse(user, 201, res)
})

// POST /api/auth/login — the ONE login for every role.
//
// 1. Portal accounts (portal_users: SUPER_ADMIN / ADMIN / CLIENT) are authenticated by the
//    Portal's own auth service, so failed-attempt lockout, audit logging and refresh-token
//    rotation behave exactly as they did in the standalone Portal.
// 2. Everyone else (users: user / partner / sales / admin) uses the LauncherDesk flow.
//
// Both branches answer with the same contract — the backend decides the workspace:
//   { success, userType, workspace, role, roleLabel, redirect, redirectTo, permissions,
//     accessToken, token, refreshTokenDelivery, user, partner? }
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body
  if (!email || !password) return next(new AppError('Email and password are required', 400))
  const normalizedEmail = String(email).toLowerCase().trim()

  // ── Portal account ─────────────────────────────────────────────────────────
  const { User: PortalUser } = require('../models/portal')
  if (await PortalUser.exists({ email: normalizedEmail })) {
    const portalAuth = require('../services/portal/auth.service')
    const { REFRESH_COOKIE_NAME, refreshCookieOptions } = require('./portal/auth.controller')
    let result
    try {
      result = await portalAuth.login({
        email: normalizedEmail,
        password,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      })
    } catch (err) {
      return next(new AppError(err.message || 'Invalid email or password', err.statusCode || 401))
    }
    const { user, accessToken, refreshToken } = result
    // httpOnly cookie, path /api/portal/auth — read by /api/portal/auth/refresh on reload.
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions())

    const route = routeForRole(user.role)
    const safeUser = portalAuth.serializeUser(user)
    return res.status(200).json({
      success: true,
      userType: 'portal',
      workspace: route.workspace,
      role: user.role,
      roleLabel: route.label,
      redirect: route.home,
      redirectTo: route.home,              // kept for existing frontend callers
      permissions: safeUser.permissions,
      accessToken,
      refreshTokenDelivery: 'httpOnly-cookie',
      user: safeUser,
    })
  }

  // ── LauncherDesk account ───────────────────────────────────────────────────
  const user = await User.findOne({ email: normalizedEmail }).select('+password')
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid email or password', 401))
  }
  if (!user.isActive) return next(new AppError('Account is deactivated', 403))

  const route = routeForRole(user.role)
  const token = signToken(user._id)
  const body = {
    success: true,
    userType: 'launcherdesk',
    workspace: route.workspace,
    role: user.role,
    roleLabel: route.label,
    redirect: route.home,
    redirectTo: route.home,
    permissions: LEGACY_PERMISSIONS[user.role] || [],
    token,                                 // LauncherDesk roles use a single 7-day JWT
    accessToken: token,
    refreshTokenDelivery: 'none',
    user: {
      _id:   user._id,
      name:  user.name,
      email: user.email,
      role:  user.role,
      emailVerified: !!user.emailVerified,
    },
  }

  // Partners need their profile to hydrate the partner workspace (same shape as /api/partners/login).
  if (user.role === 'partner') {
    const Partner = require('../models/Partner')
    const partner = await Partner.findOne({ userId: user._id })
    if (!partner) return next(new AppError('Partner profile not found', 404))
    body.partner = {
      _id:         partner._id,
      companyName: partner.companyName,
      productName: partner.productName,
      status:      partner.status,
      email:       partner.email,
      categories:  partner.categories,
    }
  }

  res.status(200).json(body)
})

// GET /api/auth/me  (protected)
exports.getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user })
})
