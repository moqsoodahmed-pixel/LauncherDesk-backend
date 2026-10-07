'use strict';

/**
 * Server-Sent Events endpoint for real-time notification updates.
 * Clients connect once and receive push events instead of polling every 30s.
 * Falls back gracefully: if the connection drops, the frontend reverts to polling.
 *
 * Security: auth token verified on connection via Bearer header.
 * Each SSE connection is scoped to req.user — never broadcasts cross-user.
 */

const express = require('express');
const router = express.Router();

const { verifyAccessToken } = require('../../services/portal/token.service');
const { User } = require('../../models/portal');
const { USER_STATUS } = require('../../constants/portal/userStatus');
const notificationService = require('../../services/portal/notification.service');

// In-memory registry of active SSE clients: userId (string) → Set of res objects
const clients = new Map();

function addClient(userId, res) {
  const id = String(userId);
  if (!clients.has(id)) clients.set(id, new Set());
  clients.get(id).add(res);
}

function removeClient(userId, res) {
  const id = String(userId);
  const set = clients.get(id);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(id);
  }
}

/**
 * Push a JSON event to all active SSE connections for a given userId.
 * Called by notification.service.js after creating a notification.
 * Never throws.
 */
function pushToUser(userId, eventName, payload) {
  const id = String(userId);
  const set = clients.get(id);
  if (!set || set.size === 0) return;
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { /* ignore dead connection */ }
  }
}

// GET /api/sse — authenticated SSE stream
router.get('/', async (req, res) => {
  // Authenticate via Bearer token in Authorization header
  // (EventSource API in browsers cannot set custom headers, so we also accept
  //  a 'token' query parameter as a fallback — it must not be logged.)
  const header = req.headers.authorization || '';
  const [scheme, headerToken] = header.split(' ');
  const rawToken = (scheme === 'Bearer' && headerToken) ? headerToken : (req.query.token || '');

  if (!rawToken) {
    return res.status(401).json({ success: false, message: 'Missing authentication token.' });
  }

  let decoded;
  try {
    decoded = verifyAccessToken(rawToken);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }

  const user = await User.findById(decoded.sub).select('_id status tokenVersion role').lean();
  if (!user || user.status !== USER_STATUS.ACTIVE) {
    return res.status(401).json({ success: false, message: 'User not found or inactive.' });
  }
  if ((decoded.tv ?? 0) !== (user.tokenVersion ?? 0)) {
    return res.status(401).json({ success: false, message: 'Session invalidated.' });
  }

  // Set SSE headers
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no', // disable Nginx buffering
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Send initial unread count so the client syncs immediately on connect
  try {
    const unreadCount = await notificationService.getUnreadCount(user._id);
    res.write(`event: unread_count\ndata: ${JSON.stringify({ unreadCount })}\n\n`);
  } catch { /* non-fatal */ }

  // Heartbeat every 25s to keep proxy/load-balancer connections alive
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 25000);

  addClient(user._id, res);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(user._id, res);
  });
});

module.exports = router;
module.exports.pushToUser = pushToUser;
