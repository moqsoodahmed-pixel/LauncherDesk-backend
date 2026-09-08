const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true },
    email: { type: String, required: [true, 'Email is required'], unique: true, lowercase: true, trim: true },
    password: { type: String, required: [true, 'Password is required'], minlength: 6, select: false },
    phone: { type: String, trim: true },
    role: { type: String, enum: ['user', 'admin', 'partner', 'sales'], default: 'user' },
    isActive: { type: Boolean, default: true },

    // ── OAuth providers ───────────────────────────────────────────────────────
    googleId: { type: String, sparse: true },
    microsoftId: { type: String, sparse: true },
    authProvider: { type: String, enum: ['local', 'google', 'microsoft'], default: 'local' },
    avatar: { type: String },

    // ── Password reset ────────────────────────────────────────────────────────
    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date },
  },
  { timestamps: true }
)

// Hash password before saving (only when password field is modified)
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

// Compare plain password with stored hash
userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password)
}

module.exports = mongoose.model('User', userSchema)