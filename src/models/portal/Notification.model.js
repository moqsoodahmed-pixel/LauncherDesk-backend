const mongoose = require('mongoose');
const { Schema } = mongoose;
const { ALL_NOTIFICATION_EVENTS } = require('../../constants/portal/notificationEvents');
const { ALL_NOTIFICATION_SEVERITIES, NOTIFICATION_SEVERITY } = require('../../constants/portal/notificationSeverity');

/**
 * Phase 0 introduced this model with a minimal shape (recipient/type/title/
 * message/isRead). Phase 10 extends it in place - no second notification
 * model/collection.
 */
const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'PortalUser', required: true, index: true },
    recipientRole: { type: String, default: null }, // denormalized for display convenience only, never used for authorization

    type: { type: String, enum: ALL_NOTIFICATION_EVENTS, required: true, index: true }, // e.g. "ORDER_ASSIGNED", "KYC_REJECTED"
    severity: { type: String, enum: ALL_NOTIFICATION_SEVERITIES, default: NOTIFICATION_SEVERITY.INFO },

    title: { type: String, required: true },
    message: { type: String, required: true },

    relatedResourceType: { type: String, default: null }, // "Order", "Client", "User", etc.
    relatedResourceId: { type: Schema.Types.ObjectId, default: null },
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', default: null, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', default: null, index: true },

    // Allowlisted-at-creation-time (see notification.service.js) - only
    // safe, already-public-within-the-app identifiers/labels, never
    // secrets/tokens/document bytes/storage keys.
    metadata: { type: Schema.Types.Mixed, default: {} },

    isRead: { type: Boolean, default: false, index: true },
    isArchived: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null }, // optional TTL - notifications only, never audit logs

    // Phase 11 addition: a BUSINESS-level outcome, distinct from isRead/
    // isArchived (both per-recipient UI state only). Some notifications
    // (e.g. ORDER_PAID_AWAITING_ASSIGNMENT, fanned out to every Super
    // Admin) represent an open operational gap that is only truly closed
    // by someone taking the real action elsewhere (assigning an admin) -
    // that closure must apply to every recipient's copy at once, which
    // isRead/isArchived (set per-recipient by that recipient's own UI
    // actions) cannot model. Defaults to unresolved; only ever flipped by
    // server-side business logic (e.g. orderAssignment.service.js), never
    // by a user directly marking a notification read/archived.
    resolved: { type: Boolean, default: false, index: true },
    resolvedAt: { type: Date, default: null },

    // Deterministic per-logical-notification key (type:relatedResourceId:recipient[:suffix])
    // so the same business event dispatched twice (e.g. a retried webhook)
    // never creates a duplicate notification, while two DIFFERENT events of
    // the same type (e.g. two separate ORDER_STATUS_CHANGED transitions)
    // remain distinct via the suffix/resourceId.
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: true, collection: 'portal_notifications' }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, readAt: 1 });
// TTL index: only deletes documents that HAVE an expiresAt set (sparse) -
// never applies to documents where expiresAt is null, and this collection
// is notifications only, never AuditLog.
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

module.exports = mongoose.model('PortalNotification', notificationSchema);
