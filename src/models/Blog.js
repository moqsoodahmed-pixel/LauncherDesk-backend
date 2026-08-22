const mongoose = require('mongoose')

const blogSchema = new mongoose.Schema(
  {
    slug:        { type: String, required: true, unique: true, lowercase: true },
    title:       { type: String, required: true, trim: true },
    excerpt:     { type: String },
    content:     { type: String },            // HTML / Markdown body
    coverImage:  { type: String },            // file path or URL
    category:    { type: String },
    tags:        [{ type: String }],
    author:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },
    metaTitle:   { type: String },
    metaDesc:    { type: String },
    views:       { type: Number, default: 0 },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Blog', blogSchema)
