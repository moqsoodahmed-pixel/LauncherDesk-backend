const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Stores hashed refresh tokens (never the raw token) so rotation and
 * revocation can be enforced server-side rather than trusting a
 * stateless JWT alone.
 */
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'PortalUser', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },

    // Every token descended from one login shares a sessionId. Reuse of an
    // already-rotated token revokes the whole session.
    sessionId: { type: String, required: true, index: true },

    issuedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },

    revoked: { type: Boolean, default: false },
    revokedAt: { type: Date, default: null },
    replacedByTokenHash: { type: String, default: null },

    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true, collection: 'portal_refresh_tokens' }
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PortalRefreshToken', refreshTokenSchema);
