const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Backs race-safe sequence generation (see services/orderSequence.service.js).
 * `_id` is the sequence's key (e.g. "order-2026"); `seq` is incremented
 * atomically via findOneAndUpdate({...}, { $inc: { seq: 1 } }, { upsert: true }),
 * which MongoDB guarantees is a single atomic document operation even
 * without a multi-document transaction - safe on a standalone dev mongod,
 * not just a replica set.
 */
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

module.exports = mongoose.model('PortalCounter', counterSchema, 'portal_counters');
