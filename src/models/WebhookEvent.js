const mongoose = require('mongoose')

/** Razorpay webhook deliveries already processed (Razorpay may deliver the same event more than once). */
const webhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },   // x-razorpay-event-id header
    event:   { type: String },
    payload: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

module.exports = mongoose.model('WebhookEvent', webhookEventSchema)
