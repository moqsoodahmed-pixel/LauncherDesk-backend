const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Append-only dedup ledger for inbound Razorpay webhook deliveries.
 * Razorpay may deliver the same event more than once; `eventId` is unique,
 * so a second delivery hits a duplicate-key error and is treated as an
 * already-processed no-op (see services/payment.service.js#processWebhookEvent)
 * rather than re-applying the event's side effects. Never stores the raw
 * webhook payload - only what's needed to identify/audit the event.
 */
const paymentWebhookEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true }, // Razorpay's top-level "id" (e.g. evt_...)
    eventType: { type: String, required: true }, // e.g. payment.captured
    payment: { type: Schema.Types.ObjectId, ref: 'PortalPayment', default: null },
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', default: null },
    processedAt: { type: Date, default: Date.now },
    outcome: { type: String, default: null }, // short human-readable result, e.g. "order transitioned to PAYMENT_CONFIRMED"
  },
  { timestamps: true, collection: 'portal_payment_webhook_events' }
);

module.exports = mongoose.model('PortalPaymentWebhookEvent', paymentWebhookEventSchema);
