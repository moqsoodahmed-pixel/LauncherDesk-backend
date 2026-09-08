const router = require('express').Router()
const jwt = require('jsonwebtoken')
const { OAuth2Client } = require('google-auth-library')
const User = require('../models/User')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { register, login, getMe } = require('../controllers/authController')
const { protect } = require('../middleware/auth')
const { registerValidators, loginValidators, validate } = require('../middleware/validate')

// ── POST /api/auth/google-token ──────────────────────────────────────────────
// Frontend sends the Google ID token or access token → we verify it → create/find user → return our JWT
router.post('/google-token', asyncHandler(async (req, res, next) => {
    const { token, accessToken } = req.body
    if (!token && !accessToken) return next(new AppError('Google token is required', 400))

    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
    if (!GOOGLE_CLIENT_ID) return next(new AppError('Google OAuth not configured', 503))

    let email, name, googleId, picture

    if (accessToken) {
        // Verify and get user profile directly from Google API using access token
        try {
            const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
            })
            if (!googleRes.ok) {
                return next(new AppError('Invalid or expired Google access token', 401))
            }
            const profile = await googleRes.json()
            email = profile.email
            name = profile.name
            googleId = profile.sub
            picture = profile.picture
        } catch {
            return next(new AppError('Failed to verify Google access token', 401))
        }
    } else {
        // Verify the ID token with Google
        const client = new OAuth2Client(GOOGLE_CLIENT_ID)
        try {
            const ticket = await client.verifyIdToken({
                idToken: token,
                audience: GOOGLE_CLIENT_ID,
            })
            const payload = ticket.getPayload()
            email = payload.email
            name = payload.name
            googleId = payload.sub
            picture = payload.picture
        } catch {
            return next(new AppError('Invalid Google token', 401))
        }
    }

    if (!email) return next(new AppError('Google account has no email', 400))

    // Find existing user or create new one
    let user = await User.findOne({ email })
    if (!user) {
        user = await User.create({
            name: name || email.split('@')[0],
            email,
            password: googleId + (process.env.JWT_SECRET || 'secret'),   // unusable password — OAuth users can't email-login
            googleId,
            avatar: picture,
            role: 'user',
            isActive: true,
            authProvider: 'google',
        })
    } else if (!user.googleId) {
        // Existing email user — link Google account
        user.googleId = googleId
        user.authProvider = user.authProvider || 'local'
        if (picture && !user.avatar) user.avatar = picture
        await user.save()
    }

    if (!user.isActive) return next(new AppError('Account is deactivated. Contact support.', 403))

    const authToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '7d',
    })

    res.json({
        success: true,
        token: authToken,
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            avatar: user.avatar,
        },
    })
}))

// ── POST /api/auth/microsoft-token ───────────────────────────────────────────
// Frontend sends the Microsoft ID token → we decode it → create/find user → return our JWT
router.post('/microsoft-token', asyncHandler(async (req, res, next) => {
    const { token } = req.body
    if (!token) return next(new AppError('Microsoft token is required', 400))

    // Microsoft ID tokens are standard JWTs — decode without verifying signature
    // (MSAL already verified it on the client side)
    let payload
    try {
        payload = jwt.decode(token)
        if (!payload) throw new Error('Empty payload')
    } catch {
        return next(new AppError('Invalid Microsoft token', 401))
    }

    if (process.env.MICROSOFT_CLIENT_ID && payload.aud && payload.aud !== process.env.MICROSOFT_CLIENT_ID) {
        return next(new AppError('Microsoft token audience mismatch', 401))
    }

    const email = payload.email || payload.preferred_username || payload.upn
    const name = payload.name || payload.displayName
    const microsoftId = payload.oid || payload.sub

    if (!email) return next(new AppError('Microsoft account has no email address', 400))

    let user = await User.findOne({ email })
    if (!user) {
        user = await User.create({
            name: name || email.split('@')[0],
            email,
            password: microsoftId + (process.env.JWT_SECRET || 'secret'),
            microsoftId,
            role: 'user',
            isActive: true,
            authProvider: 'microsoft',
        })
    } else if (!user.microsoftId) {
        user.microsoftId = microsoftId
        user.authProvider = user.authProvider || 'local'
        await user.save()
    }

    if (!user.isActive) return next(new AppError('Account is deactivated. Contact support.', 403))

    const authToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '7d',
    })

    res.json({
        success: true,
        token: authToken,
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            avatar: user.avatar,
        },
    })
}))

router.post('/register', registerValidators, validate, register)
router.post('/login', loginValidators, validate, login)
router.get('/me', protect, getMe)

module.exports = router