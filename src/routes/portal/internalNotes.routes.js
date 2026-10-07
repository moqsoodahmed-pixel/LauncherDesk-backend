'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true }); // orderId from parent

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const { ROLES } = require('../../constants/portal/roles');
const { InternalNote } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { sendSuccess } = require('../../utils/portal/apiResponse');

// Staff only — clients must never see internal notes
router.use(authenticate, requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN));

// List notes for an order
router.get('/', async (req, res, next) => {
  try {
    const notes = await InternalNote.find({ order: req.params.orderId })
      .populate('author', 'name adminCode email')
      .sort({ createdAt: -1 });
    sendSuccess(res, { message: 'Internal notes fetched.', data: notes });
  } catch (err) {
    next(err);
  }
});

// Create a note
router.post('/', async (req, res, next) => {
  try {
    const { body } = req.body;
    if (!body || !body.trim()) throw AppError.badRequest('Note body is required.');
    const note = await InternalNote.create({
      order: req.params.orderId,
      body: body.trim(),
      author: req.user._id,
    });
    await note.populate('author', 'name adminCode email');
    sendSuccess(res, { statusCode: 201, message: 'Note created.', data: note });
  } catch (err) {
    next(err);
  }
});

// Edit a note (author or super admin only)
router.patch('/:noteId', async (req, res, next) => {
  try {
    const { body } = req.body;
    if (!body || !body.trim()) throw AppError.badRequest('Note body is required.');
    const note = await InternalNote.findOne({ _id: req.params.noteId, order: req.params.orderId });
    if (!note) throw AppError.notFound('Note not found.');
    if (
      req.user.role !== ROLES.SUPER_ADMIN &&
      note.author.toString() !== req.user._id.toString()
    ) {
      throw AppError.forbidden('You can only edit your own notes.');
    }
    note.editHistory.push({ body: note.body, editedAt: new Date() });
    note.body = body.trim();
    note.editedAt = new Date();
    await note.save();
    await note.populate('author', 'name adminCode email');
    sendSuccess(res, { message: 'Note updated.', data: note });
  } catch (err) {
    next(err);
  }
});

// Delete a note (author or super admin only)
router.delete('/:noteId', async (req, res, next) => {
  try {
    const note = await InternalNote.findOne({ _id: req.params.noteId, order: req.params.orderId });
    if (!note) throw AppError.notFound('Note not found.');
    if (
      req.user.role !== ROLES.SUPER_ADMIN &&
      note.author.toString() !== req.user._id.toString()
    ) {
      throw AppError.forbidden('You can only delete your own notes.');
    }
    await note.deleteOne();
    sendSuccess(res, { message: 'Note deleted.', data: null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
