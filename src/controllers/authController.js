const mongoose    = require('mongoose')
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
  jwt.sign({ id }, process.env.JWT_SECRET || 'launcherdesk_jwt_fallback_secret_key_2026', { expiresIn: process.env.JWT_EXPIRE || '7d' })

// Roles whose session lives in the Portal (portal_users + PORTAL_JWT_* tokens).
// They must always leave login through a portal path; a legacy JWT_SECRET token
// is not verifiable by /api/portal/* and would 401 on every request.
const PORTAL_DESTINED_ROLES = ['user', 'admin', 'super_admin']

/**
 * Mongoose buffers queries while the connection is still coming up (readyState 2
 * = connecting), so a login that lands in that window completes normally. Testing
 * for readyState === 1 alone reported "no database" during every reconnect and
 * cold start, which silently skipped the portal sync below and handed the client
 * a legacy 7-day token as its portal access token.
 */
const isDatabaseUsable = () => [1, 2].includes(mongoose.connection.readyState)

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
  const normalizedEmail = String(email).toLowerCase().trim()

  const existing = await User.findOne({ email: normalizedEmail })
  const isDbReady = isDatabaseUsable()
  let existingPortal = false
  if (isDbReady) {
    const { User: PortalUser } = require('../models/portal')
    existingPortal = await PortalUser.findOne({ email: normalizedEmail }).catch(() => null)
  }
  if (existing || existingPortal) return next(new AppError('Email already registered', 409))

  // 1. Create LauncherDesk User record
  const user = await User.create({ name, email: normalizedEmail, password, phone, emailVerified: false })
  require('../services/otpService').sendOtp(user).catch(err => console.error('[OTP] send on register failed:', err.message))

  const legacyToken = signToken(user._id)
  const route = routeForRole('CLIENT')

  // 2. Create Portal Client and Portal User records if DB is live
  if (isDbReady) {
    try {
      const { User: PortalUser, Client: PortalClient } = require('../models/portal')
      const { hashPassword } = require('../services/portal/password.service')
      const { generateClientCode } = require('../services/portal/idGenerator.service')
      const portalAuth = require('../services/portal/auth.service')
      const { REFRESH_COOKIE_NAME, refreshCookieOptions } = require('./portal/auth.controller')

      const clientCode = await generateClientCode()
      const passwordHash = await hashPassword(password)
      const portalUserDoc = await PortalUser.create({
        name,
        email: normalizedEmail,
        passwordHash,
        role: 'CLIENT',
        status: 'ACTIVE',
        tokenVersion: 0,
        notificationPreferences: { inAppEnabled: true },
      })

      const clientDoc = await PortalClient.create({
        clientCode,
        user: portalUserDoc._id,
        name,
        companyName: name,
        email: normalizedEmail,
        phone: phone || '',
        status: 'ACTIVE',
      })

      portalUserDoc.clientProfile = clientDoc._id
      await portalUserDoc.save()

      let loginResult
      try {
        loginResult = await portalAuth.login({
          email: normalizedEmail,
          password,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        })
      } catch (e) {
        console.error('[Register] Portal login auto-issue failed:', e.message)
      }

      // Without portal tokens this cannot be answered as a portal session: the
      // legacy token would be stored as portal_access_token and 401 against every
      // /api/portal/* route. The account exists, so send them to sign in normally.
      if (!loginResult?.accessToken || !loginResult?.refreshToken) {
        return next(new AppError('Your account was created. Please sign in to continue.', 503))
      }

      const safePortalUser = portalAuth.serializeUser(portalUserDoc)

      res.cookie(REFRESH_COOKIE_NAME, loginResult.refreshToken, refreshCookieOptions())

      return res.status(201).json({
        success: true,
        userType: 'portal',
        workspace: 'portal',
        role: 'CLIENT',
        roleLabel: 'Portal Client',
        redirect: route.home,
        redirectTo: route.home,
        permissions: safePortalUser.permissions,
        token: legacyToken,
        accessToken: loginResult.accessToken,
        refreshToken: loginResult.refreshToken,
        refreshTokenDelivery: 'httpOnly-cookie',
        user: safePortalUser,
      })
    } catch (err) {
      console.error('[Register] Portal sync error:', err.message)
    }
  }

  return res.status(201).json({
    success: true,
    userType: 'launcherdesk',
    workspace: route.workspace,
    role: 'CLIENT',
    roleLabel: 'Portal Client',
    redirect: route.home,
    redirectTo: route.home,
    token: legacyToken,
    accessToken: legacyToken,
    user: { id: user._id, name: user.name, email: user.email, role: user.role || 'user' },
  })
})

// POST /api/auth/login — the ONE login for every role.
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body
  if (!email || !password) return next(new AppError('Email and password are required', 400))
  const normalizedEmail = String(email).toLowerCase().trim()

  const isDbReady = isDatabaseUsable()
  if (isDbReady) {
    const { User: PortalUser } = require('../models/portal')
    if (await PortalUser.exists({ email: normalizedEmail }).catch(() => false)) {
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
        redirectTo: route.home,
        permissions: safeUser.permissions,
        accessToken,
        token: accessToken,
        refreshToken,
        refreshTokenDelivery: 'httpOnly-cookie',
        user: safeUser,
      })
    }
  }

  // ── LauncherDesk account ───────────────────────────────────────────────────
  const user = await User.findOne({ email: normalizedEmail }).select('+password')
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Invalid email or password', 401))
  }
  if (!user.isActive) return next(new AppError('Account is deactivated', 403))

  // If this user is an admin or super admin, sync into portal_users as ADMIN or SUPER_ADMIN
  const isSuperAdminEmail = normalizedEmail === 'moqsood@launcherdesk.com' || normalizedEmail === (process.env.ADMIN_EMAIL || '').toLowerCase()
  if (isDbReady && (isSuperAdminEmail || user.role === 'super_admin' || user.role === 'admin')) {
    const { User: PortalUser } = require('../models/portal')
    const { hashPassword } = require('../services/portal/password.service')
    const { generateAdminCode } = require('../services/portal/idGenerator.service')
    const { ALL_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } = require('../constants/portal/permissions')
    const { ROLES } = require('../constants/portal/roles')
    const portalAuth = require('../services/portal/auth.service')
    const { REFRESH_COOKIE_NAME, refreshCookieOptions } = require('./portal/auth.controller')

    const targetRole = (isSuperAdminEmail || user.role === 'super_admin') ? ROLES.SUPER_ADMIN : ROLES.ADMIN
    const targetPerms = targetRole === ROLES.SUPER_ADMIN ? ALL_PERMISSIONS : DEFAULT_ADMIN_PERMISSIONS
    let pUser = await PortalUser.findOne({ email: normalizedEmail })
    if (!pUser) {
      pUser = await PortalUser.create({
        name: user.name || 'Admin',
        email: normalizedEmail,
        passwordHash: await hashPassword(password),
        role: targetRole,
        permissions: targetPerms,
        status: 'ACTIVE',
        adminCode: await generateAdminCode(),
        notificationPreferences: { inAppEnabled: true },
      })
    } else {
      pUser.role = targetRole
      pUser.permissions = targetPerms
      pUser.status = 'ACTIVE'
      pUser.passwordHash = await hashPassword(password)
      await pUser.save()
    }

    const loginRes = await portalAuth.login({
      email: normalizedEmail,
      password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.cookie(REFRESH_COOKIE_NAME, loginRes.refreshToken, refreshCookieOptions())

    const route = routeForRole(targetRole)
    const safeUser = portalAuth.serializeUser(loginRes.user)
    return res.status(200).json({
      success: true,
      userType: 'portal',
      workspace: route.workspace,
      role: targetRole,
      roleLabel: route.label,
      redirect: route.home,
      redirectTo: route.home,
      permissions: safeUser.permissions,
      accessToken: loginRes.accessToken,
      token: loginRes.accessToken,
      refreshToken: loginRes.refreshToken,
      refreshTokenDelivery: 'httpOnly-cookie',
      user: safeUser,
    })
  }

  // If this user is a regular customer/user, sync into portal_users as CLIENT
  if (isDbReady && user.role === 'user') {
    const { User: PortalUser, Client: PortalClient } = require('../models/portal')
    const { hashPassword } = require('../services/portal/password.service')
    const { generateClientCode } = require('../services/portal/idGenerator.service')
    const portalAuth = require('../services/portal/auth.service')
    const { REFRESH_COOKIE_NAME, refreshCookieOptions } = require('./portal/auth.controller')

    let pUser = await PortalUser.findOne({ email: normalizedEmail })
    if (!pUser) {
      const clientCode = await generateClientCode()
      pUser = await PortalUser.create({
        name: user.name || 'Client',
        email: normalizedEmail,
        passwordHash: await hashPassword(password),
        role: 'CLIENT',
        status: 'ACTIVE',
        tokenVersion: 0,
        notificationPreferences: { inAppEnabled: true },
      })
      const clientDoc = await PortalClient.create({
        clientCode,
        user: pUser._id,
        name: user.name || 'Client',
        companyName: user.name || 'Client',
        email: normalizedEmail,
        phone: user.phone || '',
        status: 'ACTIVE',
      })
      pUser.clientProfile = clientDoc._id
      await pUser.save()
    } else {
      pUser.passwordHash = await hashPassword(password)
      pUser.status = 'ACTIVE'
      await pUser.save()
    }

    const loginRes = await portalAuth.login({
      email: normalizedEmail,
      password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.cookie(REFRESH_COOKIE_NAME, loginRes.refreshToken, refreshCookieOptions())

    const route = routeForRole('CLIENT')
    const safeUser = portalAuth.serializeUser(loginRes.user)
    return res.status(200).json({
      success: true,
      userType: 'portal',
      workspace: route.workspace,
      role: 'CLIENT',
      roleLabel: route.label,
      redirect: route.home,
      redirectTo: route.home,
      permissions: safeUser.permissions,
      accessToken: loginRes.accessToken,
      token: loginRes.accessToken,
      refreshToken: loginRes.refreshToken,
      refreshTokenDelivery: 'httpOnly-cookie',
      user: safeUser,
    })
  }

  // Reaching here with a portal-destined role means the portal sync above could not
  // run. Continuing would answer 200 with userType 'launcherdesk' and a legacy
  // JWT_SECRET token that the frontend stores as portal_access_token: every
  // /api/portal/* call then 401s on a signature mismatch, and because this branch
  // issues no refresh token the recovery refresh 401s too, trapping the user in a
  // redirect loop back to /user/login. Fail loudly instead of issuing a dead session.
  if (isSuperAdminEmail || PORTAL_DESTINED_ROLES.includes(user.role)) {
    return next(new AppError('Sign-in is temporarily unavailable. Please try again in a moment.', 503))
  }

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
    token,
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
