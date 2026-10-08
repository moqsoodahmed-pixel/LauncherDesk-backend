const mongoose = require('mongoose');
const { ALL_ROLES } = require('../../constants/portal/roles');
const { Schema } = mongoose;

/**
 * NEW model (Part 5 enterprise KYC), kept separate from KycVerification
 * rather than extending it. Reasoning: KycVerification is an append-only
 * REVIEW-OUTCOME event log (REVIEW_STARTED/VERIFIED/REJECTED/NEED_REUPLOAD)
 * with a fixed `action`/`resultingStatus` shape that kycState.service.js's
 * order-reconciliation logic depends on; a free-text comment thread (with
 * internal-only vs client-visible visibility, and client-authored entries)
 * is a different write pattern and a different access-control surface, and
 * bolting it onto KycVerification would force every existing reader of
 * that collection to filter out comment rows. A separate collection keeps
 * both simple and keeps KycVerification completely untouched in shape.
 *
 * Scoping: a comment is always scoped to an order (`order`, required) and
 * OPTIONALLY to one specific document (`document`, nullable) - e.g. "please
 * re-scan this PAN card" vs. a general "KYC looks good overall" remark on
 * the order's KYC as a whole.
 */
const kycCommentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', required: true, index: true },
    document: { type: Schema.Types.ObjectId, ref: 'PortalKycDocument', default: null, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', required: true, index: true },

    message: { type: String, required: true, trim: true, maxlength: 4000 },

    // INTERNAL: only SUPER_ADMIN/ADMIN reviewers ever see it (reviewer notes
    // to each other). CLIENT_VISIBLE: shown to the client too. A CLIENT-
    // authored comment is always CLIENT_VISIBLE (enforced in the service,
    // not here, since a client should never even be able to attempt
    // INTERNAL).
    visibility: { type: String, enum: ['INTERNAL', 'CLIENT_VISIBLE'], required: true, default: 'CLIENT_VISIBLE', index: true },

    authorUser: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
    authorRole: { type: String, enum: ALL_ROLES, required: true },
    authorName: { type: String, required: true }, // display-name snapshot, survives the author's account being later renamed/deleted
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'portal_kyc_comments' }
);

kycCommentSchema.index({ order: 1, createdAt: -1 });
kycCommentSchema.index({ document: 1, createdAt: -1 });

module.exports = mongoose.model('PortalKycComment', kycCommentSchema);
