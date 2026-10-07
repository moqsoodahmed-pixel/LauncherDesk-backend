const mongoose = require('mongoose');
const { ALL_SERVICE_STATUSES, SERVICE_STATUS } = require('../../constants/portal/serviceStatus');
const { ALL_SERVICE_CATEGORIES, SERVICE_CATEGORY } = require('../../constants/portal/serviceCategory');
const { SERVICE_FORM_FIELD_TYPES } = require('../../constants/portal/serviceFormFieldTypes');
const { ALL_DOCUMENT_TYPES } = require('../../constants/portal/documentTypes');
const { SUPPORTED_CURRENCIES } = require('../../services/portal/money.service');
const { Schema } = mongoose;

/**
 * One configurable form field. Pure data/configuration - never executed,
 * only rendered and validated against on a future order-creation form. Key
 * safety (no `$`, `.`, or other Mongo-path syntax) is enforced in
 * validators/services.validators.js, which runs before anything here is
 * persisted.
 */
const formFieldSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: SERVICE_FORM_FIELD_TYPES, required: true },
    required: { type: Boolean, default: false },
    placeholder: { type: String, default: null },
    description: { type: String, default: null },
    options: { type: [String], default: undefined }, // required for select/multiselect/radio
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    minLength: { type: Number, default: null },
    maxLength: { type: Number, default: null },
    pattern: { type: String, default: null }, // stored as data only, never compiled/executed server-side in this phase
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: false }
);

const requiredDocumentSchema = new Schema(
  {
    documentType: { type: String, enum: ALL_DOCUMENT_TYPES, required: true },
    label: { type: String, required: true, trim: true },
    mandatory: { type: Boolean, default: true },
  },
  { _id: false }
);

const serviceSchema = new Schema(
  {
    serviceCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    }, // immutable after creation - see services.service.js updateService()

    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    name: { type: String, required: true, trim: true },
    shortDescription: { type: String, trim: true, default: '' },
    description: { type: String, default: '' }, // plain text only - no HTML/rich-text sanitization strategy exists yet

    category: { type: String, enum: ALL_SERVICE_CATEGORIES, default: SERVICE_CATEGORY.OTHER, index: true },

    // Pricing - ALWAYS integer minor units (paise). See services/money.service.js.
    basePriceMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: SUPPORTED_CURRENCIES, default: 'INR' },
    gstApplicable: { type: Boolean, default: true },
    gstPercentage: { type: Number, min: 0, max: 100, default: 18 },

    status: { type: String, enum: ALL_SERVICE_STATUSES, default: SERVICE_STATUS.ACTIVE, index: true },
    sortOrder: { type: Number, default: 0 },

    isPublic: { type: Boolean, default: false },
    requiresKyc: { type: Boolean, default: false },
    requiresClientDetails: { type: Boolean, default: true },

    slaDays: { type: Number, default: null, min: 1 },

    formSchema: {
      fields: { type: [formFieldSchema], default: [] },
    },
    requiredDocuments: { type: [requiredDocumentSchema], default: [] },

    createdBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
  },
  { timestamps: true, collection: 'portal_services' }
);

serviceSchema.index({ status: 1, isPublic: 1 });
serviceSchema.index({ category: 1, status: 1 });
serviceSchema.index({ sortOrder: 1 });

module.exports = mongoose.model('PortalService', serviceSchema);
