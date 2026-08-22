const mongoose = require('mongoose')

const contactSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true },
    mobile:        { type: String, required: true, trim: true },
    email:         { type: String, required: true, lowercase: true, trim: true },
    state:         { type: String, required: true },
    message:       { type: String, trim: true },
    whatsappOptin: { type: Boolean, default: true },
    source:        { type: String, default: 'contact-page' }, // e.g. contact-page, pricing-cta, service-finder
    service:       { type: String },                           // if enquiry is about a specific service
    status: {
      type: String,
      enum: ['new', 'contacted', 'qualified', 'converted', 'closed'],
      default: 'new',
    },
    notes: { type: String },  // internal CRM notes
  },
  { timestamps: true }
)

module.exports = mongoose.model('Contact', contactSchema)
