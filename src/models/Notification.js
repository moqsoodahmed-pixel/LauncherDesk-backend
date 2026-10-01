const mongoose = require('mongoose')

/**
 * One row per email (or, later, SMS / WhatsApp message) the notification
 * engine tries to send. `idempotencyKey` is unique, so the same event can
 * never produce the same email twice (duplicate webhooks, double clicks,
 * retries, admin updating a status twice...).
 */
const notificationSchema = new mongoose.Schema(
  {
    customer:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    order:             { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceOrder', index: true },
    orderNumber:       { type: String, index: true },
    templateId:        { type: String, required: true, index: true },
    eventType:         { type: String, required: true, index: true },
    channel:           { type: String, enum: ['email', 'sms', 'whatsapp'], default: 'email' },
    recipientEmail:    { type: String },
    subject:           { type: String },
    html:              { type: String },
    text:              { type: String },
    provider:          { type: String },
    providerMessageId: { type: String },
    status: {
      type: String,
      enum: ['QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'FAILED', 'BOUNCED', 'SKIPPED'],
      default: 'QUEUED',
      index: true,
    },
    attemptCount:   { type: Number, default: 0 },
    nextAttemptAt:  { type: Date, default: Date.now, index: true },
    // Optional guard checked right before sending, e.g. don't send
    // "Payment pending" if the order has been paid in the meantime.
    skipIfOrderStatusIn: [{ type: String }],
    idempotencyKey: { type: String, required: true, unique: true },
    resendOf:       { type: mongoose.Schema.Types.ObjectId, ref: 'Notification' },
    variables:      { type: mongoose.Schema.Types.Mixed },
    sentAt:      Date,
    deliveredAt: Date,
    openedAt:    Date,
    clickedAt:   Date,
    failedAt:    Date,
    failureReason: String,
  },
  { timestamps: true }
)

notificationSchema.index({ status: 1, nextAttemptAt: 1 })
notificationSchema.index({ order: 1, createdAt: 1 })

module.exports = mongoose.model('Notification', notificationSchema)
