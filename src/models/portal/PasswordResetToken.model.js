const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Single-use password reset tokens. Only the SHA-256 hash of the token is
 * stored; the raw token exists only in the email/link sent to the user.
 */
const passwordResetTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'PortalUser', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    requestedIp: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'portal_password_reset_tokens' }
);

passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PortalPasswordResetToken', passwordResetTokenSchema);
