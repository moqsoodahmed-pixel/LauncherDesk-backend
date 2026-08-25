const mongoose = require('mongoose')

const PartnerLeadSchema = new mongoose.Schema({
  partnerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
  // Visitor info (captured when they click "Visit Website" or "Get Quote" on marketplace)
  name:         { type: String, trim: true },
  email:        { type: String, trim: true, lowercase: true },
  mobile:       { type: String, trim: true },
  company:      { type: String, trim: true },
  message:      { type: String },
  // Context
  source:       { type: String, default: 'marketplace' }, // marketplace | product-page | category-page
  category:     { type: String },
  // Status
  status:       { type: String, enum: ['new','contacted','converted','lost'], default: 'new' },
}, { timestamps: true })

module.exports = mongoose.model('PartnerLead', PartnerLeadSchema)
