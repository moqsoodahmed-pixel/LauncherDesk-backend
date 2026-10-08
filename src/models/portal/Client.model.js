const mongoose = require('mongoose');
const { ALL_CLIENT_STATUSES, CLIENT_STATUS } = require('../../constants/portal/clientStatus');
const { ALL_BUSINESS_TYPES } = require('../../constants/portal/businessTypes');
const { Schema } = mongoose;

const clientSchema = new Schema(
  {
    clientCode: { type: String, required: true, unique: true, index: true }, // e.g. LD-2026-1006-0001
    legacyClientCode: { type: String, default: null, index: true },
    legacyCode: { type: String, default: null, index: true },

    user: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null }, // linked login account, if any

    name: { type: String, required: true, trim: true },
    companyName: { type: String, trim: true, default: null },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true, default: null },
    alternatePhone: { type: String, trim: true, default: null },

    address: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    country: { type: String, default: 'India' },
    postalCode: { type: String, trim: true, default: null },

    gst: {
      number: { type: String, default: null },
      applicable: { type: Boolean, default: false },
    },
    panNumber: { type: String, trim: true, uppercase: true, default: null },

    // New, additive, optional (Part 5 enterprise KYC) - drives
    // services/portal/kycRequirements.service.js's resolved document list.
    // Nullable so every existing client row (none has this field today,
    // confirmed via a live DB check) is completely unaffected; the client
    // simply gets no resolved requirements until they set it via their
    // profile. GST-registered vs not is intentionally NOT duplicated here -
    // `gst.applicable` above already covers it.
    businessType: { type: String, enum: ALL_BUSINESS_TYPES, default: null },

    notes: { type: String, default: null }, // internal only - never exposed through the Client self-service profile endpoint

    status: {
      type: String,
      enum: ALL_CLIENT_STATUSES,
      default: CLIENT_STATUS.PENDING,
      index: true,
    },

    assignedAdmin: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null, index: true },
    assignedAt: { type: Date, default: null },

    lastActivityAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
  },
  { timestamps: true, collection: 'portal_clients' }
);

clientSchema.index({ assignedAdmin: 1, status: 1 });
clientSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PortalClient', clientSchema);
