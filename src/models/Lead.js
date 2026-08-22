const mongoose = require('mongoose')

const leadSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true },
    email:         { type: String, required: true, lowercase: true, trim: true },
    mobile:        { type: String, trim: true },
    state:         { type: String },
    businessType:  { type: String },    // e.g. 'Startup', 'SME'
    serviceInterest: { type: String },  // e.g. 'private-limited-company-registration'
    message:       { type: String },
    source:        { type: String, default: 'website' },
    utmSource:     { type: String },
    utmMedium:     { type: String },
    utmCampaign:   { type: String },
    status: {
      type: String,
      enum: ['new', 'working', 'nurturing', 'converted', 'lost'],
      default: 'new',
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Lead', leadSchema)
