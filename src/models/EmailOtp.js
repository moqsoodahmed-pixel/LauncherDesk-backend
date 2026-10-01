const mongoose = require('mongoose')

/** One active OTP per user. The OTP itself is stored only as a hash. */
const emailOtpSchema = new mongoose.Schema(
  {
    user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    otpHash:   { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts:  { type: Number, default: 0 },
    lastSentAt:{ type: Date, default: Date.now },
    sentTimes: [{ type: Date }],       // for per-hour rate limiting
  },
  { timestamps: true }
)

module.exports = mongoose.model('EmailOtp', emailOtpSchema)
