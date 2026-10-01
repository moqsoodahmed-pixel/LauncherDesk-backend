const mongoose = require('mongoose')

/** Audit trail of everything that happens to an order (status changes, payments, emails...). */
const eventLogSchema = new mongoose.Schema(
  {
    order:          { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceOrder', index: true },
    orderNumber:    { type: String, index: true },
    customer:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    eventType:      { type: String, required: true, index: true },
    previousStatus: { type: String },
    newStatus:      { type: String },
    triggeredBy:    { type: String, default: 'system' },   // 'system' | 'customer' | 'razorpay' | admin email
    metadata:       { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

eventLogSchema.index({ order: 1, createdAt: 1 })

module.exports = mongoose.model('EventLog', eventLogSchema)
