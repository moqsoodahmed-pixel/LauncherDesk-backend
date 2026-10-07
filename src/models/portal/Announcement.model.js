'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const announcementSchema = new Schema(
  {
    announcementCode: { type: String, unique: true, sparse: true, index: true },
    legacyAnnouncementCode: { type: String, default: null, index: true },
    legacyCode: { type: String, default: null, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    type: {
      type: String,
      enum: ['NOTICE', 'MAINTENANCE', 'DOWNTIME', 'POLICY', 'FEATURE', 'HOLIDAY'],
      default: 'NOTICE',
    },
    targetAudience: {
      type: String,
      enum: ['ALL', 'ADMINS', 'CLIENTS', 'OPERATIONS', 'SUPPORT'],
      default: 'ALL',
    },
    priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'], default: 'NORMAL' },
    isActive: { type: Boolean, default: true },
    isPinned: { type: Boolean, default: false },
    scheduledAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
  },
  { timestamps: true, collection: 'portal_announcements' }
);

announcementSchema.index({ isActive: 1, expiresAt: 1 });
announcementSchema.index({ targetAudience: 1, isActive: 1 });

module.exports = mongoose.model('PortalAnnouncement', announcementSchema);
