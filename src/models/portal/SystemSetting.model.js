const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Simple key/value store for runtime-configurable settings
 * (e.g. retention days, feature flags) that Super Admin can change
 * without redeploying. Falls back to env.js defaults when a key is
 * absent.
 */
const systemSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, required: true },
    description: { type: String, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
  },
  { timestamps: true, collection: 'portal_system_settings' }
);

module.exports = mongoose.model('PortalSystemSetting', systemSettingSchema);
