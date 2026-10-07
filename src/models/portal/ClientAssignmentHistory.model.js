const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Append-only history of Admin<->Client assignment changes. Complements
 * (does not replace) the AuditLog entries written for the same events -
 * this collection is the structured, Client-scoped record a detail page
 * can query directly, while AuditLog remains the general-purpose log.
 */
const clientAssignmentHistorySchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: 'PortalClient', required: true, index: true },
    previousAdmin: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
    newAdmin: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
    action: { type: String, enum: ['ASSIGNED', 'REASSIGNED', 'UNASSIGNED'], required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'PortalUser', required: true },
    reason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'portal_client_assignment_histories' }
);

clientAssignmentHistorySchema.index({ client: 1, createdAt: -1 });

module.exports = mongoose.model('PortalClientAssignmentHistory', clientAssignmentHistorySchema);
