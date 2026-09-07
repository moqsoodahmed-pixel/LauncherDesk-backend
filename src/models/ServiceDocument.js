const mongoose = require('mongoose')

const serviceDocumentSchema = new mongoose.Schema(
  {
    order:   { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceOrder', required: true, index: true },
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name:        { type: String, required: true },
    description: { type: String },
    type: {
      type: String,
      enum: ['required', 'submitted', 'verified', 'output', 'other'],
      default: 'required',
    },
    filename:     { type: String },
    filePath:     { type: String },
    mimeType:     { type: String },
    fileSize:     { type: Number },
    status: {
      type: String,
      enum: ['pending', 'uploaded', 'under-review', 'accepted', 'rejected'],
      default: 'pending',
    },
    rejectionReason: { type: String },
    reviewedAt:      { type: Date },
    reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)

serviceDocumentSchema.index({ order: 1, type: 1 })
serviceDocumentSchema.index({ user: 1, status: 1 })

module.exports = mongoose.model('ServiceDocument', serviceDocumentSchema)