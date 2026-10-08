/**
 * Email OTP: 6 digits, stored only as an HMAC hash, one active code per user
 * (a new request replaces the old one), configurable expiry, resend cooldown,
 * per-hour cap and a maximum number of wrong attempts.
 */
const crypto = require('crypto')
const EmailOtp = require('../models/EmailOtp')
const User = require('../models/User')
const NotificationSetting = require('../models/NotificationSetting')
const events = require('./events')

const hash = (userId, otp) => crypto.createHmac('sha256', process.env.OTP_SECRET || process.env.JWT_SECRET).update(`${userId}:${otp}`).digest('hex')
const err = (msg, statusCode = 400, extra = {}) => Object.assign(new Error(msg), { statusCode, ...extra })

async function sendOtp(user) {
  if (user.emailVerified) throw err('Email is already verified', 400)
  const s = await NotificationSetting.getSettings()
  const now = Date.now()
  const rec = await EmailOtp.findOne({ user: user._id })

  if (rec) {
    const wait = s.otpResendCooldownSeconds * 1000 - (now - rec.lastSentAt.getTime())
    if (wait > 0) throw err(`Please wait ${Math.ceil(wait / 1000)} seconds before requesting a new code.`, 429, { retryAfter: Math.ceil(wait / 1000) })
    const lastHour = (rec.sentTimes || []).filter(t => now - new Date(t).getTime() < 3600000)
    if (lastHour.length >= s.otpMaxPerHour) throw err('Too many codes requested. Please try again in an hour.', 429)
  }

  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
  const sentTimes = [...((rec?.sentTimes || []).filter(t => now - new Date(t).getTime() < 3600000)), new Date()]
  await EmailOtp.findOneAndUpdate(
    { user: user._id },
    { otpHash: hash(user._id, otp), expiresAt: new Date(now + s.otpExpiryMinutes * 60000), attempts: 0, lastSentAt: new Date(), sentTimes },
    { upsert: true }
  )
  await events.emit('CUSTOMER_REGISTERED', {
    customerId: user._id, triggeredBy: 'customer', sensitive: true,
    dedupe: `otp-${now}`, extra: { otp, otp_expiry_minutes: String(s.otpExpiryMinutes) },
  })
  return { expiresInMinutes: s.otpExpiryMinutes, resendAfterSeconds: s.otpResendCooldownSeconds }
}

async function verifyOtp(user, otp) {
  if (user.emailVerified) return { alreadyVerified: true }
  const s = await NotificationSetting.getSettings()
  const rec = await EmailOtp.findOne({ user: user._id })
  if (!rec) throw err('No active code. Please request a new one.')
  if (rec.expiresAt < new Date()) { await rec.deleteOne(); throw err('This code has expired. Please request a new one.') }
  if (rec.attempts >= s.otpMaxAttempts) { await rec.deleteOne(); throw err('Too many incorrect attempts. Please request a new code.', 429) }

  const ok = crypto.timingSafeEqual(Buffer.from(rec.otpHash), Buffer.from(hash(user._id, String(otp || '').trim())))
  if (!ok) { rec.attempts += 1; await rec.save(); throw err(`Incorrect code. ${Math.max(0, s.otpMaxAttempts - rec.attempts)} attempt(s) left.`) }

  await rec.deleteOne()
  await User.updateOne({ _id: user._id }, { emailVerified: true, emailVerifiedAt: new Date() })
  await events.emit('EMAIL_VERIFIED', { customerId: user._id, triggeredBy: 'customer' })
  return { verified: true }
}

module.exports = { sendOtp, verifyOtp }
