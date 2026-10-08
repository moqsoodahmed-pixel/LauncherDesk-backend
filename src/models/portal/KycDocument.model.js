const mongoose = require('mongoose');
const {
  KYC_DOCUMENT_STATUS,
  ALL_KYC_DOCUMENT_STATUSES,
  ALL_KYC_DOCUMENT_LIFECYCLE_STATES,
  KYC_DOCUMENT_LIFECYCLE,
} = require('../../constants/portal/kycStatus');
const { ALL_DOCUMENT_TYPES } = require('../../constants/portal/documentTypes');
const { Schema } = mongoose;

/**
 * Stores METADATA ONLY. The actual file bytes live in the storage adapter
 * (local disk in dev, S3-compatible bucket in production, see
 * adapters/storage/) and are referenced here only by an opaque storageKey
 * (select:false - never included in a query result by default, and never
 * serialized to any API response). Never add a field here that holds raw
 * file contents or a public URL.
 *
 * Versioning: a rejected document is never edited in place. Re-upload
 * creates a NEW row with `version` incremented and `isCurrentVersion:
 * true`; the previous row's `isCurrentVersion` is flipped to `false` but
 * the row (and its file, until retention deletion) is kept for audit
 * history. Exactly one row per (order, documentType) has
 * `isCurrentVersion: true` at a time.
 */
const kycDocumentSchema = new Schema(
  {
    kycCode: { type: String, default: null, index: true, sparse: true },
    legacyKycCode: { type: String, default: null, index: true },
    legacyCode: { type: String, default: null, index: true },

    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', required: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', required: true, index: true },

    documentType: { type: String, enum: ALL_DOCUMENT_TYPES, required: true, index: true },
    version: { type: Number, required: true, default: 1 },
    isCurrentVersion: { type: Boolean, default: true, index: true },

    originalFileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    checksum: { type: String, required: true, index: true }, // SHA-256 hex digest of the file content

    // 'cloudinary' added (Part 5, additive) alongside the existing 'local'/'s3'
    // values - see adapters/storage/CloudinaryStorageAdapter.js. Existing rows
    // only ever contain 'local' or 's3' and are completely unaffected.
    storageProvider: { type: String, enum: ['local', 's3', 'cloudinary'], required: true },
    storageKey: { type: String, required: true, select: false }, // opaque reference, never exposed to any API response

    status: {
      type: String,
      enum: ALL_KYC_DOCUMENT_STATUSES,
      default: KYC_DOCUMENT_STATUS.UPLOADED,
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },

    // Wave 2 addition (additive, nullable). The reviewer an Admin/Super
    // Admin has designated to handle this specific document - purely
    // informational/organizational (does not gate who may actually call
    // verify/reject; the existing VERIFY_KYC/REJECT_KYC permission checks
    // are unchanged). Set via kyc.service.js's assignReviewer.
    assignedReviewer: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null, index: true },

    // New, additive, optional (Part 5 enterprise KYC). The document's OWN
    // real-world expiry (e.g. a passport/driving license's expiry date) -
    // distinct from `retentionExpiresAt` below, which is about WHEN WE
    // DELETE THE FILE, not whether its contents are still valid. Set by a
    // reviewer (manually, or later by OCR extraction) when verifying a
    // document that itself expires. Used only by the new, display-only
    // services/portal/kycDisplayStatus.service.js to compute the
    // client-facing "Expired" label - never changes `status` itself.
    validUntil: { type: Date, default: null },

    lifecycleStatus: {
      type: String,
      enum: ALL_KYC_DOCUMENT_LIFECYCLE_STATES,
      default: KYC_DOCUMENT_LIFECYCLE.ACTIVE,
      index: true,
    },
    retentionExpiresAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: null }, // "SYSTEM_RETENTION_JOB" or an admin user id as string
    deletionReason: { type: String, default: null },

    uploadedBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', required: true },
  },
  { timestamps: true, collection: 'portal_kyc_documents' }
);

kycDocumentSchema.index({ order: 1, documentType: 1, isCurrentVersion: 1 });
kycDocumentSchema.index({ lifecycleStatus: 1, retentionExpiresAt: 1 });
kycDocumentSchema.index({ createdAt: -1 });
// Phase 11 reporting: KYC/admin analytics filter by review outcome + when
// the review happened.
kycDocumentSchema.index({ status: 1, reviewedAt: -1 });
kycDocumentSchema.index({ reviewedBy: 1, reviewedAt: -1 });

module.exports = mongoose.model('PortalKycDocument', kycDocumentSchema);
