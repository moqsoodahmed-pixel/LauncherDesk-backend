const mongoose = require('mongoose')

const serviceOrderSchema = new mongoose.Schema(
  {
    user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceSlug:  { type: String, required: true, index: true },
    serviceTitle: { type: String, required: true },
    serviceCategory: { type: String },
    payment:      { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    quotedRef:    { type: mongoose.Schema.Types.ObjectId, ref: 'Quote' },
    professionalFee: { type: Number },
    govtFee:         { type: Number },
    totalAmount:     { type: Number },
    currency:        { type: String, default: 'INR' },
    status: {
      type: String,
      enum: ['received', 'in-progress', 'pending-docs', 'processing', 'completed', 'on-hold', 'cancelled'],
      default: 'received',
      index: true,
    },
    assignedProfessional: {
      name:        { type: String },
      designation: { type: String },
      email:       { type: String },
      phone:       { type: String },
    },
    steps: [{
      title:       { type: String, required: true },
      description: { type: String },
      status: {
        type: String,
        enum: ['pending', 'in-progress', 'completed', 'skipped'],
        default: 'pending',
      },
      completedAt: { type: Date },
      _id: false,
    }],
    adminNotes:   { type: String, select: false },
    startedAt:    { type: Date },
    completedAt:  { type: Date },
    expectedBy:   { type: Date },
    externalRef:  { type: String },
    unreadMessages: { type: Number, default: 0 },
  },
  { timestamps: true }
)

serviceOrderSchema.index({ user: 1, status: 1 })
serviceOrderSchema.index({ user: 1, createdAt: -1 })
serviceOrderSchema.index({ status: 1, createdAt: -1 })

module.exports = mongoose.model('ServiceOrder', serviceOrderSchema)