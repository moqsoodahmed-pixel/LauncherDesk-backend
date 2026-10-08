const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Stores OCR-extracted fields SEPARATELY from KycDocument (per the brief's
 * explicit requirement) - one row per KycDocument VERSION (a re-uploaded
 * document gets its own new KycOcrData row against its own new KycDocument
 * row, mirroring KycDocument's own versioning model). Nothing in the
 * codebase writes to this collection yet - see adapters/ocr/ (architecture
 * only, provider disabled). This model exists so the next wave can start
 * persisting extraction results the moment a real OCR provider is wired in,
 * without a schema migration.
 */
const kycOcrDataSchema = new Schema(
  {
    document: { type: Schema.Types.ObjectId, ref: 'PortalKycDocument', required: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', required: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', required: true, index: true },

    // Flat, optional-string extracted-field bag. All optional since any
    // given document type only ever populates a subset (a PAN card yields
    // panNumber/name/dob; a cancelled cheque yields ifsc/accountNumber/name).
    fields: {
      panNumber: { type: String, default: null },
      gstNumber: { type: String, default: null },
      ifsc: { type: String, default: null },
      accountNumber: { type: String, default: null },
      name: { type: String, default: null },
      dob: { type: String, default: null },
      address: { type: String, default: null },
      companyName: { type: String, default: null },
      registrationNumber: { type: String, default: null },
    },

    source: { type: String, default: 'disabled' }, // the OCR provider name that produced this row (adapters/ocr/)
    confidence: { type: Number, default: 0, min: 0, max: 1 },
    extractedAt: { type: Date, default: Date.now },

    // Kept for audit/debugging only - never surfaced to a client.
    rawProviderResponse: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'portal_kyc_ocr_data' }
);

kycOcrDataSchema.index({ document: 1, createdAt: -1 });

module.exports = mongoose.model('PortalKycOcrData', kycOcrDataSchema);
