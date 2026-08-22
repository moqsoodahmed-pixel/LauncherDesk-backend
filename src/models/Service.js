const mongoose = require('mongoose')

const serviceSchema = new mongoose.Schema(
  {
    slug:         { type: String, required: true, unique: true, lowercase: true, trim: true },
    title:        { type: String, required: true, trim: true },
    eyebrow:      { type: String },
    lead:         { type: String },
    category:     { type: String },   // e.g. 'Business Setup', 'Compliance', 'Legal & IP'
    priceFrom:    { type: String },   // display string, e.g. 'Custom quote'
    isActive:     { type: Boolean, default: true },
    isFeatured:   { type: Boolean, default: false },
    sortOrder:    { type: Number, default: 0 },
    // SEO
    metaTitle:    { type: String },
    metaDesc:     { type: String },
    // Full page data stored as flexible JSON (mirrors the frontend services.js structure)
    pageData:     { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Service', serviceSchema)
