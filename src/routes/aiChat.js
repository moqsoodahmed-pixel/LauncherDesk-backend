'use strict';

/**
 * AI Chat route — powered by Voiceflow Dialog Manager API
 *
 * Voiceflow DM API docs: https://www.voiceflow.com/api/dialog-manager
 *
 * Each browser session gets a unique userID (UUID). Voiceflow maintains
 * its own conversation state server-side, so we only forward the message
 * and return whatever Voiceflow responds with.
 *
 * We still log every turn to MongoDB so the admin panel keeps working.
 */

const router   = require('express').Router();
const { body } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const AiChat   = require('../models/AiChat');

/* ── Voiceflow config ─────────────────────────────────────────── */
const VF_API_KEY    = process.env.VOICEFLOW_API_KEY || '';
// Support both VOICEFLOW_VERSION_ID and VOICEFLOW_VERSION_ALIAS in .env
const VF_VERSION_ID = process.env.VOICEFLOW_VERSION_ID || process.env.VOICEFLOW_VERSION_ALIAS || 'production';
const VF_PROJECT_ID = process.env.VOICEFLOW_PROJECT_ID || '';

// Voiceflow requires "Bearer <key>" in the Authorization header
const VF_AUTH = VF_API_KEY.startsWith('Bearer ') ? VF_API_KEY : `Bearer ${VF_API_KEY}`;

const VF_BASE = 'https://general-runtime.voiceflow.com';

/**
 * Send one turn to Voiceflow and collect all response traces.
 * Returns an array of text strings from the agent's response.
 */
async function sendToVoiceflow(userID, action) {
  const url = `${VF_BASE}/state/user/${encodeURIComponent(userID)}/interact`;

  const res = await fetch(url, {
    method : 'POST',
    headers: {
      'Content-Type' : 'application/json',
      'Authorization': VF_AUTH,
      'versionID'    : VF_VERSION_ID,
    },
    body: JSON.stringify({
      action,
      config: {
        tts            : false,
        stripSSML      : true,
        stopAll        : false,
        excludeTypes   : ['block', 'debug', 'flow'],
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Voiceflow error ${res.status}: ${text}`), { status: 502 });
  }

  const traces = await res.json(); // array of trace objects

  /* Collect text from speak / text traces */
  const messages = [];
  for (const trace of traces) {
    if (trace.type === 'speak' || trace.type === 'text') {
      const msg = trace.payload?.message || trace.payload?.slate?.content || '';
      if (msg) messages.push(String(msg).trim());
    }
    if (trace.type === 'carousel' || trace.type === 'choice') {
      /* Optionally surface button labels as hints */
      const buttons = trace.payload?.buttons || trace.payload?.choices || [];
      if (buttons.length) {
        const hints = buttons.map(b => b.name || b.request?.payload?.label || '').filter(Boolean);
        if (hints.length) messages.push(`You can choose: ${hints.join(' · ')}`);
      }
    }
  }

  return messages.length ? messages : ['I\'m here to help — could you tell me a bit more?'];
}

/**
 * Delete Voiceflow session state (clears conversation context for that user).
 */
async function deleteVoiceflowState(userID) {
  await fetch(`${VF_BASE}/state/user/${encodeURIComponent(userID)}`, {
    method : 'DELETE',
    headers: { 'Authorization': VF_AUTH, 'versionID': VF_VERSION_ID },
  }).catch(() => {}); // best-effort
}

/* ── POST /api/v1/ai-chat/message ───────────────────────────── */
router.post('/message', [
  body('message').trim().notEmpty().withMessage('Message is required').isLength({ max: 2000 }),
  body('sessionId').optional().trim().isLength({ max: 64 }),
  body('launch').optional().isBoolean(),   // true = start a new conversation
], validate, async (req, res, next) => {
  try {
    if (!VF_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'VOICEFLOW_API_KEY is not configured on the server.'
      });
    }

    const { message, launch } = req.body;
    const sessionId = req.body.sessionId || uuidv4();

    /* On first turn (launch), send a launch action first so Voiceflow
       triggers its opening block, then send the user message */
    let replies = [];

    if (launch) {
      // Start a fresh VF session
      await deleteVoiceflowState(sessionId);
      const launchReplies = await sendToVoiceflow(sessionId, { type: 'launch' });
      replies = launchReplies;
    }

    /* Send the actual user message */
    const turnReplies = await sendToVoiceflow(sessionId, {
      type   : 'text',
      payload: message,
    });

    replies = replies.concat(turnReplies);
    const reply = replies.join('\n\n');

    /* Log to MongoDB (best effort — don't fail the request if DB is down) */
    AiChat.findOneAndUpdate(
      { sessionId },
      {
        $push: { messages: [
          { role: 'user',      content: message },
          { role: 'assistant', content: reply   },
        ]},
        $set        : { ipAddress: req.ip },
        $setOnInsert: { sessionId, intent: 'unknown' },
      },
      { upsert: true }
    ).catch(err => console.error('[AiChat log]', err.message));

    res.json({ success: true, data: { sessionId, reply, replies } });
  } catch (err) {
    next(err);
  }
});

/* ── POST /api/v1/ai-chat/launch ─ start / restart a session ── */
router.post('/launch', [
  body('sessionId').optional().trim().isLength({ max: 64 }),
], validate, async (req, res, next) => {
  try {
    if (!VF_API_KEY) {
      return res.status(503).json({ success: false, message: 'VOICEFLOW_API_KEY not configured.' });
    }

    const sessionId = req.body.sessionId || uuidv4();
    await deleteVoiceflowState(sessionId);

    const replies = await sendToVoiceflow(sessionId, { type: 'launch' });
    const reply   = replies.join('\n\n');

    res.json({ success: true, data: { sessionId, reply, replies } });
  } catch (err) {
    next(err);
  }
});

/* ── POST /api/v1/ai-chat/contact – attach contact to session ─ */
router.post('/contact', [
  body('sessionId').trim().notEmpty(),
  body('name').trim().optional(),
  body('email').trim().optional().isEmail().normalizeEmail(),
  body('mobile').trim().optional(),
], validate, async (req, res, next) => {
  try {
    const { sessionId, name, email, mobile } = req.body;
    await AiChat.findOneAndUpdate({ sessionId }, { $set: { name, email, mobile } });
    res.json({ success: true, message: 'Contact details saved' });
  } catch (err) {
    next(err);
  }
});

/* ── GET /api/v1/ai-chat  (admin) ──────────────────────────── */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { intent, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (intent) filter.intent = intent;
    const skip = (Number(page) - 1) * Number(limit);
    const [docs, total] = await Promise.all([
      AiChat.find(filter).sort('-createdAt').skip(skip).limit(Number(limit)).lean(),
      AiChat.countDocuments(filter),
    ]);
    res.json({ success: true, data: docs, meta: { total, page: Number(page), limit: Number(limit) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;