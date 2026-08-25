const mongoose = require('mongoose')

const PartnerSchema = new mongoose.Schema({
  companyName:  { type: String, required: true, trim: true },
  contactName:  { type: String, required: true, trim: true },
  email:        { type: String, required: true, trim: true, lowercase: true },
  mobile:       { type: String, required: true, trim: true },
  website:      { type: String, trim: true },
  city:         { type: String, trim: true },
  state:        { type: String, trim: true },
  foundedYear:  { type: String },
  teamSize:     { type: String },
  categories:   [{ type: String }],
  productName:  { type: String, required: true, trim: true },
  tagline:      { type: String, trim: true },
  description:  { type: String },
  pricing:      { type: String },
  integrations: { type: String },
  whyPartner:   { type: String },
  status:       { type: String, enum: ['pending','approved','rejected','active'], default: 'pending' },
  adminNotes:   { type: String },
  approvedAt:   { type: Date },
}, { timestamps: true })

module.exports = mongoose.model('Partner', PartnerSchema)