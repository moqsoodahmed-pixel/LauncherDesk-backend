const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * One tax-invoice PDF record per successful payment (unique index on
 * `payment` - a payment can never produce two invoice records). Stores
 * METADATA ONLY, same discipline as KycDocument.model.js: the actual PDF
 * bytes live in the storage adapter (adapters/storage/, local disk in dev,
 * S3-compatible in production) and are referenced here only by an opaque
 * storageKey (select:false - never included in a query result by default,
 * never serialized to any API response).
 *
 * invoiceNumber is INV-prefixed (see idGenerator.service.js
 * generateTaxInvoiceNumber) - distinct from Order.invoiceNumber (LD-prefixed,
 * assigned at order creation, unchanged by this model).
 */
const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },

    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', required: true, index: true },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true }, // indexed below via the partial unique index
    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', required: true, index: true },

    // Immutable snapshot of what the invoice actually says - never
    // recomputed from the live Order/Payment after generation, so a later
    // edit to the order can never silently change an already-issued invoice.
    billingSnapshot: {
      customerName: { type: String, required: true },
      customerEmail: { type: String, required: true },
      customerPhone: { type: String, default: null },
      billingAddress: { type: String, default: null },
      gstNumber: { type: String, default: null },
      serviceName: { type: String, required: true },
      serviceCategory: { type: String, required: true },
      quantity: { type: Number, required: true, default: 1 },
      unitPriceMinor: { type: Number, required: true },
      discountMinor: { type: Number, required: true, default: 0 },
      gstPercentage: { type: Number, required: true },
      gstAmountMinor: { type: Number, required: true },
      totalAmountMinor: { type: Number, required: true },
      currency: { type: String, required: true, default: 'INR' },
      paymentMethod: { type: String, default: null },
      transactionId: { type: String, default: null }, // providerPaymentId
      orderCode: { type: String, required: true },
      paymentCode: { type: String, default: null },
      paidAt: { type: Date, default: null },
    },

    originalFileName: { type: String, required: true },
    mimeType: { type: String, required: true, default: 'application/pdf' },
    sizeBytes: { type: Number, required: true },
    checksum: { type: String, required: true, index: true }, // SHA-256 hex digest, from documentStorage.service.js

    storageProvider: { type: String, enum: ['local', 's3'], required: true },
    storageKey: { type: String, required: true, select: false },

    status: { type: String, enum: ['GENERATED', 'FAILED'], default: 'GENERATED', index: true },

    emailStatus: { type: String, enum: ['NOT_SENT', 'SENT', 'FAILED'], default: 'NOT_SENT' },
    emailSentAt: { type: Date, default: null },

    generatedAt: { type: Date, default: Date.now },
    generatedBy: { type: String, default: 'SYSTEM' }, // 'SYSTEM' (auto on payment) or an Admin/SuperAdmin _id string (manual regenerate)

    // Regeneration never overwrites history - see invoice.service.js
    // regenerateInvoice(): the old row's isCurrentVersion flips to false,
    // exactly the KycDocument.model.js versioning discipline.
    version: { type: Number, required: true, default: 1 },
    isCurrentVersion: { type: Boolean, default: true, index: true },
  },
  // 'invoices' (the default pluralization) is already physically used by the
  // legacy, unrelated models/Invoice.js (registered model name 'Invoice',
  // no explicit collection option - Mongoose defaults it to 'invoices' too).
  // Discovered during testing: both schemas were silently writing to and
  // index-colliding on the SAME physical collection. 'portal_invoices'
  // fully separates them, matching this codebase's existing convention for
  // every other Portal collection (portal_users, portal_email_logs, ...).
  { timestamps: true, collection: 'portal_invoices' }
);

invoiceSchema.index({ order: 1, isCurrentVersion: 1 });
// Exactly one CURRENT invoice per payment at a time - a partial unique
// index (filtered to isCurrentVersion: true) rather than a hard unique
// index on `payment` alone, so regenerateInvoice() can supersede an old
// version (flip its isCurrentVersion to false) and insert a new row for
// the SAME payment without a duplicate-key error. Same discipline as
// KycDocument.model.js's own versioning (see its isCurrentVersion doc-comment).
invoiceSchema.index(
  { payment: 1 },
  { name: 'payment_1_current_only', unique: true, partialFilterExpression: { isCurrentVersion: true } }
);

// 'Invoice' is already registered by the legacy, unrelated models/Invoice.js
// (a different schema entirely, for the legacy User/Order/Payment system) -
// 'PortalInvoice' avoids the Mongoose model-name collision while keeping
// the same naming convention this codebase already uses for every other
// Portal-side counterpart of a legacy concept (PortalUser, PortalClient).
module.exports = mongoose.model('PortalInvoice', invoiceSchema);
