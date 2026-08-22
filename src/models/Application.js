const mongoose = require('mongoose')

const applicationSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    email:       { type: String, required: true, lowercase: true, trim: true },
    mobile:      { type: String, required: true },
    role:        { type: String, default: 'General' },  // e.g. 'Internship', 'Professional Network'
    message:     { type: String },
    resumeUrl:   { type: String },                       // uploaded file path
    status: {
      type: String,
      enum: ['received', 'under-review', 'shortlisted', 'rejected', 'hired'],
      default: 'received',
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Application', applicationSchema)
