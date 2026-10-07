const mongoose = require('mongoose');
const { ALL_ORDER_STATUSES, ORDER_STATUS } = require('../../constants/portal/orderStatus');
const { ALL_ORDER_PAYMENT_STATUSES, ORDER_PAYMENT_STATUS } = require('../../constants/portal/orderPaymentStatus');
const { ALL_ORDER_SOURCES } = require('../../constants/portal/orderSource');
const { ALL_DOCUMENT_TYPES } = require('../../constants/portal/documentTypes');
const { Schema } = mongoose;

/**
 * Snapshots of the Service and Client at the moment an order is created.
 * A Service's price/GST/config or a Client's contact details can change
 * later without altering any historical order - the order always reflects
 * the commercial terms (and KYC requirements - Phase 7) it was actually
 * created under. Never recomputed from the live Service/Client document.
 */
const requiredDocumentSnapshotSchema = new Schema(
  {
    documentType: { type: String, enum: ALL_DOCUMENT_TYPES, required: true },
    label: { type: String, required: true },
    mandatory: { type: Boolean, default: true },
  },
  { _id: false }
);

const serviceSnapshotSchema = new Schema(
  {
    serviceCode: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    category: { type: String, required: true },
    basePriceMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    gstApplicable: { type: Boolean, required: true },
    gstPercentage: { type: Number, required: true, min: 0, max: 100 },
    requiresKyc: { type: Boolean, required: true },
    requiresClientDetails: { type: Boolean, required: true },
    // Additive (Phase 7): what documents THIS order required at creation
    // time. Absent/empty on pre-Phase-7 orders - treated as "no KYC
    // requirement snapshot", never backfilled from the live Service.
    requiredDocuments: { type: [requiredDocumentSnapshotSchema], default: [] },
  },
  { _id: false }
);

const clientSnapshotSchema = new Schema(
  {
    clientCode: { type: String, required: true },
    legacyClientCode: { type: String, default: null },
    name: { type: String, required: true },
    companyName: { type: String, default: null },
    email: { type: String, required: true },
    phone: { type: String, default: null },
  },
  { _id: false }
);

/**
 * The commercial terms this order was actually created under - an
 * immutable historical record (see services/money.service.js, the only
 * place that computes these values). Integer minor units (paise) only.
 */
const pricingSchema = new Schema(
  {
    currency: { type: String, required: true },
    baseAmountMinor: { type: Number, required: true, min: 0 },
    gstApplicable: { type: Boolean, required: true },
    gstPercentage: { type: Number, required: true, min: 0, max: 100 },
    gstAmountMinor: { type: Number, required: true, min: 0 },
    totalAmountMinor: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    orderCode: { type: String, required: true, unique: true, index: true }, // e.g. LD-2026-1006-0001 — server-generated, immutable, race-safe
    legacyOrderCode: { type: String, default: null, index: true },
    legacyInvoiceNumber: { type: String, default: null, index: true },
    legacyCode: { type: String, default: null, index: true },
    invoiceNumber: { type: String, default: null, index: true }, // e.g. LD-2026-1006-0002 — auto-generated at order creation, immutable

    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', required: true, index: true },
    service: { type: Schema.Types.ObjectId, ref: 'PortalService', required: true },

    serviceSnapshot: { type: serviceSnapshotSchema, required: true },
    clientSnapshot: { type: clientSnapshotSchema, required: true },

    // Service-specific submitted data, validated against the Service's
    // formSchema at creation time (services/orderFormValidation.service.js).
    // Pure data - never executed. Keys are restricted to the field keys
    // defined in the schema (which are themselves restricted to
    // /^[A-Za-z_][A-Za-z0-9_]{0,63}$/ - see formSchema.service.js), so a
    // key containing `$` or `.` can never reach storage.
    orderDetails: { type: Schema.Types.Mixed, default: {} },

    pricing: { type: pricingSchema, required: true },

    status: { type: String, enum: ALL_ORDER_STATUSES, default: ORDER_STATUS.CREATED, index: true },
    paymentStatus: {
      type: String,
      enum: ALL_ORDER_PAYMENT_STATUSES,
      default: ORDER_PAYMENT_STATUS.NOT_REQUIRED,
    },

    assignedAdmin: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null, index: true },
    assignedAt: { type: Date, default: null },

    source: { type: String, enum: ALL_ORDER_SOURCES, required: true }, // server-determined, never client-supplied

    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'URGENT'], default: 'MEDIUM' },

    slaDeadline: { type: Date, default: null },
    slaStatus: { type: String, enum: ['ON_TIME', 'AT_RISK', 'DELAYED', 'COMPLETED'], default: null },

    notes: { type: String, default: '' }, // internal only - never exposed to CLIENT role

    cancellationReason: { type: String, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
    cancelledAt: { type: Date, default: null },

    completedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null }, // null for a client-created order
    updatedBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
  },
  { timestamps: true, collection: 'portal_orders' }
);

orderSchema.index({ client: 1, status: 1 });
orderSchema.index({ assignedAdmin: 1, status: 1 });
orderSchema.index({ service: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PortalOrder', orderSchema);
