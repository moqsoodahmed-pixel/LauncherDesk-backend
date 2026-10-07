const mongoose = require('mongoose');
const { ALL_KYC_DOCUMENT_STATUSES } = require('../../constants/portal/kycStatus');
const { Schema } = mongoose;

/**
 * Append-only review-event history for a KycDocument (review-started /
 * verified / rejected), separate from the document's current status so
 * the full review trail is preserved even as `status` moves forward.
 * This is the per-document event log; the order-level KYC summary (are
 * all required documents verified yet?) is computed on demand from
 * `Order.status` + the current-version `KycDocument` rows for that order
 * (see services/kyc.service.js's `getOrderKycSummary`) rather than
 * persisted as a second, separately-maintained aggregate that could drift
 * out of sync with the documents it summarizes.
 */
const kycVerificationSchema = new Schema(
  {
    document: { type: Schema.Types.ObjectId, ref: 'PortalKycDocument', required: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', required: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', required: true, index: true },

    action: { type: String, enum: ['REVIEW_STARTED', 'VERIFIED', 'REJECTED'], required: true },
    resultingStatus: { type: String, enum: ALL_KYC_DOCUMENT_STATUSES, required: true },
    reason: { type: String, default: null },

    performedBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'portal_kyc_verifications' }
);

kycVerificationSchema.index({ order: 1, createdAt: -1 });

module.exports = mongoose.model('PortalKycVerification', kycVerificationSchema);
