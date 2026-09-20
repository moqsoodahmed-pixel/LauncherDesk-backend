const mongoose = require('mongoose')

/**
 * A single follower-count snapshot for a social platform, entered manually
 * (or later synced from a platform API) so growth can be charted over time.
 */
const socialStatSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ['linkedin', 'facebook', 'instagram'],
      required: true,
    },
    followers: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now }, // the date this count applies to
    note: { type: String, trim: true },
    source: { type: String, enum: ['manual', 'api'], default: 'manual' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)

// One entry per platform per calendar day — re-saving the same day updates it.
socialStatSchema.index({ platform: 1, date: 1 }, { unique: true })

module.exports = mongoose.model('SocialStat', socialStatSchema)