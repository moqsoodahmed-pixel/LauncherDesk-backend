const mongoose = require('mongoose');
const { Schema } = mongoose;
const { ALL_PAYMENT_ATTEMPT_STATUSES, PAYMENT_ATTEMPT_STATUS } = require('../../constants/portal/paymentAttemptStatus');

/**
 * One document per PAYMENT ATTEMPT (Phase 8). An order can accumulate
 * several of these (e.g. FAILED, then a retry that's CONFIRMED) - history
 * is preserved, never overwritten. Never trust any field here as having
 * come from the client; every write to a provider/status/amount field
 * happens only inside services/payment.service.js, driven by a verified
 * signature or a verified webhook/reconciliation fetch.
 */
const paymentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', required: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', required: true, index: true },

    paymentCode: { type: String, default: null, index: true }, // e.g. LD-2026-1006-0001
    legacyPaymentCode: { type: String, default: null, index: true },
    legacyCode: { type: String, default: null, index: true },

    provider: { type: String, enum: ['RAZORPAY', 'DEVELOPMENT'], required: true },

    // No `default: null` - a sparse unique index only excludes documents
    // where the field is truly ABSENT, not ones where it's explicitly null,
    // and Mongoose would otherwise persist that default on every insert,
    // defeating the sparse index the moment a second Payment is created.
    providerOrderId: { type: String },
    providerPaymentId: { type: String },
    providerSignature: { type: String, default: null, select: false },

    // Integer minor units only (paise for INR) - computed exclusively from
    // Order.pricing.totalAmountMinor via services/money.service.js, never
    // from a client-submitted amount. See services/payment.service.js.
    amountPaise: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    status: { type: String, enum: ALL_PAYMENT_ATTEMPT_STATUSES, default: PAYMENT_ATTEMPT_STATUS.CREATED, index: true },

    method: { type: String, default: null }, // e.g. 'card'/'upi' - informational only, from provider fetch/webhook
    signatureVerified: { type: Boolean, default: false },
    captured: { type: Boolean, default: false },

    failedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    paidAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundAmountPaise: { type: Number, default: 0, min: 0 },

    // How many payment attempts this order has had so far (this one
    // included) - preserves attempt history/ordering without relying on
    // createdAt alone.
    attemptNumber: { type: Number, required: true, min: 1 },

    // A minimal, non-sensitive pointer to the provider event that last
    // touched this record (e.g. a webhook event id) - never the raw
    // provider payload, which may carry more than this app needs to retain.
    providerPayloadReference: { type: String, default: null },

    // Scoped to one attempt per order: `${orderId}:${attemptNumber}`.
    // Lets payment-creation be idempotent (a retried create request for the
    // same attempt resolves to the same record) without a client-supplied key.
    idempotencyKey: { type: String, required: true },
  },
  { timestamps: true, collection: 'portal_payments' }
);

paymentSchema.index({ order: 1, status: 1 });
paymentSchema.index({ providerOrderId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ providerPaymentId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true });
// Phase 11 reporting: revenue/payment analytics filter by the moment
// money actually moved (paidAt/refundedAt/failedAt), not just status -
// these power the date-range aggregations in reports.service.js.
paymentSchema.index({ status: 1, paidAt: -1 });
paymentSchema.index({ status: 1, refundedAt: -1 });
paymentSchema.index({ status: 1, failedAt: -1 });

module.exports = mongoose.model('PortalPayment', paymentSchema);
