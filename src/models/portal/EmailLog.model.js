const mongoose = require('mongoose');
const { Schema } = mongoose;
const { ALL_COMMUNICATION_CHANNELS, COMMUNICATION_CHANNEL } = require('../../constants/portal/communicationChannels');
const { ALL_COMMUNICATION_STATUSES, COMMUNICATION_STATUS } = require('../../constants/portal/communicationStatus');
const { ALL_COMMUNICATION_EVENTS } = require('../../constants/portal/communicationEvents');

/**
 * Phase 0 introduced this as an email-only log (`EmailLog`). Phase 9
 * extends the SAME model/collection into a unified, channel-agnostic
 * communication record rather than creating a second
 * "CommunicationLog"/"CommunicationDelivery" model - this record IS the
 * database-backed outbox: one document per logical communication attempt,
 * created QUEUED and updated in place as it's processed/retried.
 * Exported as `CommunicationLog` from models/index.js (the file itself is
 * kept at its original Phase-0 path/filename to preserve history).
 *
 * NEVER store here: passwords, JWTs/refresh tokens, OTP plaintext,
 * Razorpay secrets, API keys, raw KYC document bytes, card details. Only
 * sanitized template variables belong in `variables`.
 */
const communicationLogSchema = new Schema(
  {
    channel: { type: String, enum: ALL_COMMUNICATION_CHANNELS, required: true },
    eventType: { type: String, enum: ALL_COMMUNICATION_EVENTS, required: true },

    // Recipient is always resolved server-side (clientSnapshot/live Client
    // record) - never client-submitted. "to" keeps the Phase-0 field name;
    // holds an email address, or a normalized phone number for WHATSAPP/SMS.
    to: { type: String, required: true },
    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', default: null, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', default: null, index: true },

    // Generic resource link, kept from Phase 0 for non-order-related sends.
    relatedResourceType: { type: String, default: null },
    relatedResourceId: { type: Schema.Types.ObjectId, default: null },

    templateKey: { type: String, required: true }, // e.g. "ORDER_CREATED" - identifies which template rendered this
    subject: { type: String, default: null }, // EMAIL only

    // Sanitized template variables only (see communication/templates.js) -
    // never arbitrary DB objects, never secrets.
    variables: { type: Schema.Types.Mixed, default: {} },

    provider: { type: String, enum: ['BREVO', 'MSG91', 'DEVELOPMENT'], required: true },
    providerMessageId: { type: String, default: null },

    status: { type: String, enum: ALL_COMMUNICATION_STATUSES, default: COMMUNICATION_STATUS.QUEUED, index: true },
    attemptCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    errorMessage: { type: String, default: null }, // kept from Phase 0 (alias-of-intent with failureReason for the very first synchronous failure path)

    // Deterministic per-logical-event key (e.g. "ORDER_CREATED:EMAIL:<orderId>")
    // so the same business event dispatched twice never creates a second
    // delivery record - the existing one is reused/retried instead.
    idempotencyKey: { type: String, required: true, unique: true },

    // Optional reference to an already-stored file (e.g. an Invoice PDF) to
    // attach on send. A REFERENCE only, never the raw bytes - this model's
    // own rule above ("never store raw file contents") still holds. On
    // every send/retry, communicationProcessor.service.js re-reads the file
    // fresh from the storage adapter via this key, so a retry always
    // attaches the real, current file rather than a stale copy.
    attachmentStorageKey: { type: String, default: null, select: false },
    attachmentFileName: { type: String, default: null },
  },
  { timestamps: true, collection: 'portal_email_logs' }
);

communicationLogSchema.index({ order: 1, createdAt: -1 });
communicationLogSchema.index({ client: 1, createdAt: -1 });
communicationLogSchema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model('CommunicationLog', communicationLogSchema);
