'use strict';

const express = require('express');
const router = express.Router();

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const { ROLES } = require('../../constants/portal/roles');
const { Announcement } = require('../../models/portal');
const { sendSuccess } = require('../../utils/portal/apiResponse');
const { generateAnnouncementCode } = require('../../services/portal/idGenerator.service');

// All announcement management requires SUPER_ADMIN
router.use(authenticate, requireRole(ROLES.SUPER_ADMIN));

function serialize(a) {
  return {
    id: a._id,
    announcementCode: a.announcementCode,
    title: a.title,
    body: a.body,
    type: a.type,
    targetAudience: a.targetAudience,
    priority: a.priority,
    isActive: a.isActive,
    isPinned: a.isPinned,
    scheduledAt: a.scheduledAt,
    expiresAt: a.expiresAt,
    createdBy: a.createdBy ? { name: a.createdBy.name, id: a.createdBy._id } : null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// GET /announcements — list all
router.get('/', async (req, res, next) => {
  try {
    const { active, audience, type } = req.query;
    const filter = {};
    if (active === 'true') filter.isActive = true;
    if (active === 'false') filter.isActive = false;
    if (audience) filter.targetAudience = audience;
    if (type) filter.type = type;

    const now = new Date();
    if (active === 'true') {
      filter.$or = [{ expiresAt: null }, { expiresAt: { $gt: now } }];
      filter.$or2 = [{ scheduledAt: null }, { scheduledAt: { $lte: now } }];
    }

    const announcements = await Announcement.find(filter)
      .populate('createdBy', 'name')
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(100);

    sendSuccess(res, { message: 'Announcements.', data: announcements.map(serialize) });
  } catch (err) { next(err); }
});

// POST /announcements — create
router.post('/', async (req, res, next) => {
  try {
    const { title, body, type, targetAudience, priority, isPinned, scheduledAt, expiresAt } = req.body;
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ success: false, message: 'title and body are required.' });
    }
    const announcementCode = await generateAnnouncementCode();
    const announcement = await Announcement.create({
      announcementCode,
      title: title.trim(),
      body: body.trim(),
      type: type || 'NOTICE',
      targetAudience: targetAudience || 'ALL',
      priority: priority || 'NORMAL',
      isPinned: !!isPinned,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdBy: req.user._id,
    });
    await announcement.populate('createdBy', 'name');
    sendSuccess(res, { statusCode: 201, message: 'Announcement created.', data: serialize(announcement) });
  } catch (err) { next(err); }
});

// PATCH /announcements/:id — update
router.patch('/:id', async (req, res, next) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, message: 'Not found.' });

    const { title, body, type, targetAudience, priority, isActive, isPinned, scheduledAt, expiresAt } = req.body;
    if (title !== undefined) announcement.title = title.trim();
    if (body !== undefined) announcement.body = body.trim();
    if (type !== undefined) announcement.type = type;
    if (targetAudience !== undefined) announcement.targetAudience = targetAudience;
    if (priority !== undefined) announcement.priority = priority;
    if (isActive !== undefined) announcement.isActive = !!isActive;
    if (isPinned !== undefined) announcement.isPinned = !!isPinned;
    if (scheduledAt !== undefined) announcement.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    if (expiresAt !== undefined) announcement.expiresAt = expiresAt ? new Date(expiresAt) : null;
    announcement.updatedBy = req.user._id;

    await announcement.save();
    await announcement.populate('createdBy', 'name');
    sendSuccess(res, { message: 'Updated.', data: serialize(announcement) });
  } catch (err) { next(err); }
});

// DELETE /announcements/:id — delete
router.delete('/:id', async (req, res, next) => {
  try {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, message: 'Not found.' });
    sendSuccess(res, { message: 'Deleted.' });
  } catch (err) { next(err); }
});

module.exports = router;
