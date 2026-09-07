const mongoose = require('mongoose')

const paymentSchema = new mongoose.Schema(
  {
    user:              { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    razorpayOrderId:   { type: String, required: true, unique: true, index: true },
    razorpayPaymentId: { type: String, index: true },
    serviceSlug:       { type: String },
    serviceTitle:      { type: String },
    amountPaise:       { type: Number, required: true },
    amountRupees:      { type: Number, required: true },
    currency:          { type: String, default: 'INR' },
    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'refunded'],
      default: 'created',
      index: true,
    },
    verifiedAt:    { type: Date },
    failureReason: { type: String },
    processedAt:   { type: Date },
  },
  { timestamps: true }
)

paymentSchema.index({ user: 1, status: 1 })
paymentSchema.index({ createdAt: -1 })

module.exports = mongoose.model('Payment', paymentSchema)