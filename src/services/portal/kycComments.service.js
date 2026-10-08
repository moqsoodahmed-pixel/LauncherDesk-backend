const mongoose = require('mongoose');
const { KycComment } = require('../../models/portal');
const { ROLES } = require('../../constants/portal/roles');
const AppError = require('../../utils/portal/AppError');

/**
 * NEW, additive service (Part 5 enterprise KYC) for the KycComment model.
 * Minimal on purpose - no routes are wired yet; the next wave (admin
 * workflows + frontend) adds the controller/routes that call these.
 */

function serializeComment(c) {
  return {
    id: c._id,
    order: c.order,
    document: c.document ?? null,
    message: c.message,
    visibility: c.visibility,
    authorRole: c.authorRole,
    authorName: c.authorName,
    createdAt: c.createdAt,
  };
}

/**
 * @param {Object} params
 * @param {string} params.orderId
 * @param {string} params.clientId
 * @param {string|null} [params.documentId]
 * @param {string} params.message
 * @param {'INTERNAL'|'CLIENT_VISIBLE'} [params.visibility] - ignored (forced to CLIENT_VISIBLE) when actor.role === CLIENT
 * @param {{_id, role, name}} params.actor
 */
async function addComment({ orderId, clientId, documentId = null, message, visibility = 'CLIENT_VISIBLE', actor }) {
  if (!message || !message.trim()) {
    throw AppError.badRequest('A comment message is required.');
  }
  if (documentId && !mongoose.isValidObjectId(documentId)) {
    throw AppError.badRequest('Invalid document id.');
  }

  // A client can never post an INTERNAL-only comment, regardless of what's
  // passed in - the one access-control rule this service itself enforces.
  const effectiveVisibility = actor.role === ROLES.CLIENT ? 'CLIENT_VISIBLE' : (visibility === 'INTERNAL' ? 'INTERNAL' : 'CLIENT_VISIBLE');

  const created = await KycComment.create({
    order: orderId,
    document: documentId,
    client: clientId,
    message: message.trim(),
    visibility: effectiveVisibility,
    authorUser: actor._id,
    authorRole: actor.role,
    authorName: actor.name || actor.email || actor.role,
  });

  return serializeComment(created);
}

/**
 * Lists comments for an order (optionally narrowed to one document).
 * `includeInternal` must only ever be passed true by an internal
 * (SUPER_ADMIN/ADMIN) caller - the route layer is responsible for that
 * check, mirroring how every other KYC route scopes by role today.
 */
async function listComments({ orderId, documentId = null, includeInternal = false }) {
  const filter = { order: orderId };
  if (documentId) filter.document = documentId;
  if (!includeInternal) filter.visibility = 'CLIENT_VISIBLE';

  const comments = await KycComment.find(filter).sort({ createdAt: -1 });
  return comments.map(serializeComment);
}

module.exports = { addComment, listComments, serializeComment };
