const mongoose = require('mongoose')

/** Single settings document (key: 'default') — everything here is editable from the admin panel. */
const notificationSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    otpExpiryMinutes:        { type: Number, default: 10 },
    otpResendCooldownSeconds:{ type: Number, default: 60 },
    otpMaxPerHour:           { type: Number, default: 5 },
    otpMaxAttempts:          { type: Number, default: 5 },
    orderCreatedDelayMinutes:{ type: Number, default: 30 },   // wait before "order created / payment pending" email
    // Document reminders: hours after documents were requested (or the previous reminder)
    reminder1AfterHours:     { type: Number, default: 48 },
    reminder2AfterHours:     { type: Number, default: 48 },
    reminder3AfterHours:     { type: Number, default: 72 },
    holdAfterFinalReminderHours: { type: Number, default: 48 },
    feedbackDelayHours:      { type: Number, default: 24 },
    retryDelaysMinutes:      { type: [Number], default: [5, 30] },  // attempt 2 and 3
    // Which order status changes email the customer. Statuses not listed = no email.
    statusEmailEnabled: {
      type: Map, of: Boolean,
      default: {
        DOCUMENTS_UNDER_REVIEW: true, DOCUMENTS_APPROVED: true, ASSIGNED: true, PROCESSING: true,
        GOVERNMENT_PROCESSING: true, ON_HOLD: true, COMPLETED: true, DOCUMENTS_READY: true,
        CANCELLED: true, CLOSED: false,
      },
    },
    disabledTemplates: [{ type: String }],
    updatedBy: { type: String },
  },
  { timestamps: true }
)

notificationSettingSchema.statics.getSettings = async function () {
  let s = await this.findOne({ key: 'default' })
  if (!s) s = await this.create({ key: 'default' })
  return s
}

module.exports = mongoose.model('NotificationSetting', notificationSettingSchema)
