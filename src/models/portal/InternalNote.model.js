const mongoose = require('mongoose');
const { Schema } = mongoose;

const editHistorySchema = new Schema(
  { body: { type: String, required: true }, editedAt: { type: Date, required: true } },
  { _id: false }
);

const internalNoteSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'PortalOrder', required: true, index: true },
    body: { type: String, required: true, trim: true, maxlength: 10000 },
    author: { type: Schema.Types.ObjectId, ref: 'PortalUser', required: true },
    editedAt: { type: Date, default: null },
    editHistory: { type: [editHistorySchema], default: [] },
  },
  { timestamps: true, collection: 'portal_internal_notes' }
);

internalNoteSchema.index({ order: 1, createdAt: -1 });

module.exports = mongoose.model('PortalInternalNote', internalNoteSchema);
