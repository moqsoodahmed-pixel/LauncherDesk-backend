const mongoose = require('mongoose')

const faqSchema = new mongoose.Schema(
  {
    question:   { type: String, required: true, trim: true },
    answer:     { type: String, required: true },
    category:   { type: String, default: 'General' },   // e.g. 'GST', 'Company Registration'
    serviceSlug: { type: String },                       // link to a specific service
    sortOrder:  { type: Number, default: 0 },
    isActive:   { type: Boolean, default: true },
  },
  { timestamps: true }
)

module.exports = mongoose.model('FAQ', faqSchema)
