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
    // Human-readable order ID, e.g. LD-2026-001245
    orderNumber:  { type: String, unique: true, sparse: true, index: true },
    baseAmount:   { type: Number },
    discount:     { type: Number, default: 0 },
    gstAmount:    { type: Number },
    paymentStatus: {
      type: String,
      enum: ['PAYMENT_PENDING', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'PAYMENT_PARTIALLY_REFUNDED'],
      default: 'PAYMENT_PENDING',
      index: true,
    },
    documentStatus: {
      type: String,
      enum: ['NOT_REQUIRED', 'PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED'],
      default: 'PENDING',
    },
    // Central order status (see services/orderService.js). Legacy lower-case values are kept so old orders still load.
    status: {
      type: String,
      enum: [
        'CREATED', 'PAYMENT_PENDING', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'DOCUMENTS_PENDING', 'DOCUMENTS_SUBMITTED',
        'DOCUMENTS_UNDER_REVIEW', 'DOCUMENT_CORRECTION_REQUIRED', 'DOCUMENTS_APPROVED', 'ASSIGNED', 'PROCESSING',
        'GOVERNMENT_PROCESSING', 'ACTION_REQUIRED', 'ON_HOLD', 'COMPLETED', 'DOCUMENTS_READY', 'CANCELLED',
        'REFUND_INITIATED', 'REFUNDED', 'CLOSED',
        'received', 'in-progress', 'pending-docs', 'processing', 'completed', 'on-hold', 'cancelled',
      ],
      default: 'CREATED',
      index: true,
    },
    // Form data captured at checkout (e.g. e-stamp parties, document type, delivery address)
    details: { type: mongoose.Schema.Types.Mixed },
    holdReason: { type: String },
    actionRequired: {
      what:     String,
      why:      String,
      how:      String,
      deadline: Date,
      ctaUrl:   String,
    },
    documentsRequestedAt: { type: Date },
    reminderCount:        { type: Number, default: 0 },
    lastReminderAt:       { type: Date },
    feedbackRequestedAt:  { type: Date },
    cancelledAt:          { type: Date },
    cancellationReason:   { type: String },
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