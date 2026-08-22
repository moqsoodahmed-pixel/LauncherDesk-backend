const mongoose = require('mongoose')

const quoteSchema = new mongoose.Schema(
  {
    name:           { type: String, required: true, trim: true },
    email:          { type: String, required: true, lowercase: true, trim: true },
    mobile:         { type: String, required: true, trim: true },
    state:          { type: String, required: true },
    serviceSlug:    { type: String, required: true },   // e.g. 'private-limited-company-registration'
    serviceTitle:   { type: String },
    businessType:   { type: String },
    additionalInfo: { type: String },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'sent', 'accepted', 'rejected'],
      default: 'pending',
    },
    quotedAmount: { type: Number },
    quotedAt:     { type: Date },
    adminNotes:   { type: String },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Quote', quoteSchema)
