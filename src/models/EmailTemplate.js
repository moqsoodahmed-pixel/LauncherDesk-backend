const mongoose = require('mongoose')

/**
 * Admin-editable override of a built-in template (see
 * services/notification/defaultTemplates.js). If no row exists for a
 * templateId, the built-in default is used.
 */
const emailTemplateSchema = new mongoose.Schema(
  {
    templateId:   { type: String, required: true, unique: true },
    name:         { type: String },
    subject:      { type: String, required: true },
    html:         { type: String, required: true },   // body content; wrapped in the branded layout
    text:         { type: String },                   // plain-text fallback
    ctaLabel:     { type: String },
    ctaUrlVar:    { type: String },                   // e.g. 'dashboard_url'
    active:       { type: Boolean, default: true },
    isSystem:     { type: Boolean, default: false },  // system-critical: only super admins may edit
    triggerEvent: { type: String },
    variables:    [{ type: String }],
    updatedBy:    { type: String },
  },
  { timestamps: true }
)

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema)
