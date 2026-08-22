const mongoose = require('mongoose')

const productSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    slug:        { type: String, required: true, unique: true, lowercase: true },
    description: { type: String },
    price:       { type: Number, required: true },
    originalPrice: { type: Number },
    category:    { type: String, required: true },
    brand:       { type: String },
    images:      [{ type: String }],
    condition:   { type: String, enum: ['new', 'refurbished', 'used'], default: 'refurbished' },
    stock:       { type: Number, default: 0 },
    isActive:    { type: Boolean, default: true },
    isFeatured:  { type: Boolean, default: false },
    tags:        [{ type: String }],
    specs:       { type: mongoose.Schema.Types.Mixed },  // key-value pairs
    rating:      { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Product', productSchema)
