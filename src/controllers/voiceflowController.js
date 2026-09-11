/**
 * voiceflowController.js
 * AI chat backend — powered by OpenAI (replaces Groq)
 *
 * Only 3 things changed from the Groq version:
 *  1. GROQ_API_KEY  → OPENAI_API_KEY
 *  2. GROQ_URL      → OpenAI chat completions endpoint
 *  3. model name    → gpt-4o-mini  (fast, cheap, excellent quality)
 *
 * Everything else — session handling, history, fallback, exports — is IDENTICAL.
 *
 * Required env var: OPENAI_API_KEY
 * Get one at: https://platform.openai.com/api-keys
 *
 * Model options (change OPENAI_MODEL env var, no code change needed):
 *   gpt-4o-mini      — default, fast + cheap, great for support bots
 *   gpt-4o           — highest quality, slower, costs more
 *   gpt-3.5-turbo    — legacy, cheapest
 */

const axios = require('axios')
const ChatSession = require('../models/ChatSession')
const Lead = require('../models/Lead')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { LAUNCHERDESK_KB } = require('../data/knowledgeBase')

// ── Config (only these 3 lines changed from Groq version) ─────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

const FALLBACK_MSG = "Hi! I'm the LauncherDesk AI. I can help with company registration, GST, trademark, websites, digital marketing, virtual office and compliance. Please WhatsApp us at +91 85488 54859 for immediate assistance."

function buildTraces(text) {
  return [{ type: 'text', payload: { message: text } }]
}

// ── OpenAI call — identical structure to the old callGroq() ───────────────────
async function callOpenAI(userMessage, history = []) {
  const messages = [
    { role: 'system', content: LAUNCHERDESK_KB }
  ]

  // Add conversation history (last 8 messages) — same as before
  for (const msg of history.slice(-8)) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })
  }

  // Add current user message
  messages.push({ role: 'user', content: userMessage })

  const response = await axios.post(
    OPENAI_URL,
    {
      model: OPENAI_MODEL,
      messages,
      max_tokens: 500,
      temperature: 0.4,
    },
    {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  )

  const text = response.data?.choices?.[0]?.message?.content
  return text || FALLBACK_MSG
}

// ── All exports below are UNCHANGED from the original ─────────────────────────

exports.interact = asyncHandler(async (req, res, next) => {
  const { userId, action } = req.body
  if (!userId || !action) return next(new AppError('userId and action are required', 400))

  let session = await ChatSession.findOne({ voiceflowUserId: userId })
  if (!session) session = new ChatSession({ voiceflowUserId: userId })

  // ── LAUNCH ────────────────────────────────────────────────────────────────
  if (action.type === 'launch') {
    const greeting = "Hi! I'm the LauncherDesk AI — your business manager. I can help you with company registration, GST, trademark, websites, digital marketing, virtual office, compliance and more. What does your business need today?"
    session.messages.push({ role: 'bot', content: greeting })
    await session.save()
    return res.json({ success: true, traces: buildTraces(greeting) })
  }

  // ── TEXT ──────────────────────────────────────────────────────────────────
  if (action.type === 'text' && action.payload) {
    const userText = String(action.payload)
    session.messages.push({ role: 'user', content: userText })

    let replyText = FALLBACK_MSG

    if (OPENAI_API_KEY) {
      try {
        const history = session.messages.slice(0, -1).map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        }))
        replyText = await callOpenAI(userText, history)
        console.log('[OpenAI] ✓ Response received')
      } catch (err) {
        console.error('[OpenAI] Error:', err.response?.status, JSON.stringify(err.response?.data || err.message))
      }
    } else {
      console.warn('[OpenAI] No OPENAI_API_KEY set — using fallback')
    }

    session.messages.push({ role: 'bot', content: replyText })
    await session.save()
    return res.json({ success: true, traces: buildTraces(replyText) })
  }

  return res.json({ success: true, traces: [] })
})

exports.deleteSession = asyncHandler(async (req, res, next) => {
  const { userId } = req.params
  if (!userId) return next(new AppError('userId is required', 400))
  await ChatSession.deleteOne({ voiceflowUserId: userId })
  res.json({ success: true, message: 'Session cleared' })
})

exports.getSessions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, converted } = req.query
  const filter = {}
  if (converted === 'true') filter.convertedToLead = true
  if (converted === 'false') filter.convertedToLead = false
  const skip = (Number(page) - 1) * Number(limit)
  const [sessions, total] = await Promise.all([
    ChatSession.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)),
    ChatSession.countDocuments(filter),
  ])
  res.json({ success: true, total, page: Number(page), data: sessions })
})

exports.getSession = asyncHandler(async (req, res, next) => {
  const session = await ChatSession.findOne({ voiceflowUserId: req.params.userId })
  if (!session) return next(new AppError('Session not found', 404))
  res.json({ success: true, data: session })
})