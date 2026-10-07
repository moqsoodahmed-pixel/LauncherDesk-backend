const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Append-only history of Admin<->Order assignment changes, mirroring
 * ClientAssignmentHistory. Complements (does not replace) AuditLog - this
 * collection is the structured, Order-scoped record an order detail page
 * queries directly.
 */
const orderAssignmentHistorySchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', required: true, index: true },
    previousAdmin: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
    newAdmin: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
    action: { type: String, enum: ['ASSIGNED', 'REASSIGNED', 'UNASSIGNED'], required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', required: true },
    reason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'portal_order_assignment_histories' }
);

orderAssignmentHistorySchema.index({ order: 1, createdAt: -1 });

module.exports = mongoose.model('PortalOrderAssignmentHistory', orderAssignmentHistorySchema);
