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

    storageProvider: { type: String, enum: ['local', 's3'], required: true },
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
