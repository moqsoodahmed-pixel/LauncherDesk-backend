const mongoose = require('mongoose');
const { ALL_ORDER_STATUSES } = require('../../constants/portal/orderStatus');
const { Schema } = mongoose;

const orderStatusHistorySchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', required: true, index: true },
    fromStatus: { type: String, enum: [...ALL_ORDER_STATUSES, null], default: null },
    toStatus: { type: String, enum: ALL_ORDER_STATUSES, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
    reason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'portal_order_status_histories' }
);

orderStatusHistorySchema.index({ order: 1, createdAt: -1 });
// Phase 11 funnel report: counts transitions by (fromStatus,toStatus) within a date range.
orderStatusHistorySchema.index({ fromStatus: 1, toStatus: 1, createdAt: -1 });

module.exports = mongoose.model('PortalOrderStatusHistory', orderStatusHistorySchema);
