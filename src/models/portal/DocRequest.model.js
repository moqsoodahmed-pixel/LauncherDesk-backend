const mongoose = require('mongoose');
const { ALL_DOCUMENT_TYPES } = require('../../constants/portal/documentTypes');
const { Schema } = mongoose;

const DOC_REQUEST_STATUSES = ['PENDING', 'FULFILLED', 'CANCELLED'];

const docRequestSchema = new Schema(
  {
    docRequestCode: { type: String, unique: true, sparse: true, index: true },
    legacyDocRequestCode: { type: String, default: null, index: true },
    legacyCode: { type: String, default: null, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', required: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', required: true },
    documentType: { type: String, enum: ALL_DOCUMENT_TYPES, required: true },
    label: { type: String, required: true, trim: true },
    instructions: { type: String, default: '', trim: true },
    status: { type: String, enum: DOC_REQUEST_STATUSES, default: 'PENDING', index: true },
    fulfilledAt: { type: Date, default: null },
    linkedKycDocument: { type: Schema.Types.ObjectId, ref: 'PortalKycDocument', default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
  },
  { timestamps: true, collection: 'portal_doc_requests' }
);

docRequestSchema.index({ order: 1, status: 1 });
docRequestSchema.index({ client: 1, status: 1 });

module.exports = mongoose.model('PortalDocRequest', docRequestSchema);
module.exports.DOC_REQUEST_STATUSES = DOC_REQUEST_STATUSES;
