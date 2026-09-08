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
const crypto = require('crypto')

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
// User submits email → we generate a reset token → send email with reset link
router.post('/forgot-password', asyncHandler(async (req, res, next) => {
    const { email } = req.body
    if (!email) return next(new AppError('Email address is required', 400))

    const user = await User.findOne({ email: email.toLowerCase().trim() })

    // Always return success even if user not found (security — don't reveal emails)
    if (!user) {
        return res.json({
            success: true,
            message: 'If an account exists with that email, a reset link has been sent.'
        })
    }

    // Generate a secure random token
    const resetToken = crypto.randomBytes(32).toString('hex')
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex')

    // Save hashed token + expiry (15 minutes) to user
    user.passwordResetToken = hashedToken
    user.passwordResetExpires = Date.now() + 15 * 60 * 1000  // 15 min
    await user.save()

    // Build reset URL (frontend handles the form)
    const resetURL = `${process.env.CLIENT_URL}/user/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`

    // Send email via Brevo
    const { sendEmail } = require('../config/email')
    try {
        await sendEmail({
            to: email,
            subject: 'Reset your LauncherDesk password',
            html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#ffffff">
          <div style="text-align:center;margin-bottom:28px">
            <img src="https://launcherdesk.com/logo.png" alt="LauncherDesk" style="height:36px" onerror="this.style.display='none'"/>
          </div>
          <h2 style="color:#0A2540;font-size:22px;margin-bottom:8px">Reset your password</h2>
          <p style="color:#475569;font-size:15px;line-height:1.6;margin-bottom:24px">
            We received a request to reset the password for your LauncherDesk account associated with <strong>${email}</strong>.
          </p>
          <div style="text-align:center;margin-bottom:28px">
            <a href="${resetURL}" style="display:inline-block;background:linear-gradient(135deg,#1D6FE0,#0F52C0);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700">
              Reset Password →
            </a>
          </div>
          <p style="color:#94A3B8;font-size:13px;line-height:1.6">
            This link expires in <strong>15 minutes</strong>. If you didn't request a password reset, you can safely ignore this email — your password will not change.
          </p>
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0"/>
          <p style="color:#94A3B8;font-size:12px;text-align:center">
            LauncherDesk — Startups Made Easy<br/>
            472/7, 20th L Cross Rd, Koramangala, Bengaluru 560095
          </p>
        </div>
      `
        })
    } catch (err) {
        // If email fails, clear the token so user can try again
        user.passwordResetToken = undefined
        user.passwordResetExpires = undefined
        await user.save()
        return next(new AppError('Failed to send reset email. Please try again.', 500))
    }

    res.json({
        success: true,
        message: 'If an account exists with that email, a reset link has been sent.'
    })
}))

// ── POST /api/auth/reset-password ────────────────────────────────────────────
// User submits new password with the token from the email link
router.post('/reset-password', asyncHandler(async (req, res, next) => {
    const { token, email, password } = req.body

    if (!token || !email || !password) {
        return next(new AppError('Token, email and new password are required', 400))
    }
    if (password.length < 6) {
        return next(new AppError('Password must be at least 6 characters', 400))
    }

    // Hash the token from the URL to compare with stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex')

    const user = await User.findOne({
        email: email.toLowerCase().trim(),
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() },  // not expired
    })

    if (!user) {
        return next(new AppError('Reset link is invalid or has expired. Please request a new one.', 400))
    }

    // Update password — the User model pre-save hook will hash it
    user.password = password
    user.passwordResetToken = undefined
    user.passwordResetExpires = undefined
    await user.save()

    // Auto-login: return a new JWT
    const authToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '7d',
    })

    res.json({
        success: true,
        message: 'Password reset successfully. You are now logged in.',
        token: authToken,
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
    })
}))
module.exports = router