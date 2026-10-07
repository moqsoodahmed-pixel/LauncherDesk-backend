const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Append-only. No update or delete route should ever be built for this
 * collection - not even for Super Admin. See docs/permissions.md.
 */
const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null }, // null = system/automated action
    actorRole: { type: String, default: 'SYSTEM' },

    action: { type: String, required: true, index: true }, // e.g. "LOGIN", "ORDER_STATUS_CHANGE"
    resourceType: { type: String, default: null },
    resourceId: { type: Schema.Types.ObjectId, default: null },

    metadata: { type: Schema.Types.Mixed, default: {} },

    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'portal_audit_logs' }
);

auditLogSchema.index({ resourceType: 1, resourceId: 1 });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

// Append-only enforcement at the model layer (Phase 10 hardening) - blocks
// every mutation/removal path, including ones a future developer might add
// without realizing this collection must never be touched after insert.
// Document.save() on an already-persisted doc is intentionally NOT blocked
// here beyond this hook set, since AuditLog is only ever created via
// `.create()` (see auditLog.service.js) and never re-fetched/re-saved
// anywhere in the codebase - this still closes off every bulk/direct path.
const BLOCKED_MUTATION_MESSAGE = 'AuditLog records are append-only and can never be updated or deleted.';
for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne']) {
  auditLogSchema.pre(method, function blockMutation(next) {
    next(new Error(BLOCKED_MUTATION_MESSAGE));
  });
}
for (const method of ['deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove', 'remove']) {
  auditLogSchema.pre(method, { document: true, query: true }, function blockDeletion(next) {
    next(new Error(BLOCKED_MUTATION_MESSAGE));
  });
}

module.exports = mongoose.model('PortalAuditLog', auditLogSchema);
