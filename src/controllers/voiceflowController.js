const axios       = require('axios')
const ChatSession = require('../models/ChatSession')
const Lead        = require('../models/Lead')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { LAUNCHERDESK_KB } = require('../data/knowledgeBase')

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`

const FALLBACK_MSG = "Hi! I'm the LauncherDesk AI. I can help with company registration, GST, trademark, websites, digital marketing, virtual office and compliance. Please WhatsApp us at +91 85488 54859 for immediate assistance."

function buildTraces(text) {
  return [{ type: 'text', payload: { message: text } }]
}

// ── Call Gemini Free API ──────────────────────────────────────────────────────
async function callGemini(userMessage, history = []) {
  // Build conversation history for Gemini
  const contents = []

  // Add chat history (last 10 turns)
  for (const msg of history.slice(-10)) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    })
  }

  // Add current user message
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  })

  const response = await axios.post(
    `${GEMINI_URL}?key=${GEMINI_API_KEY}`,
    {
      system_instruction: {
        parts: [{ text: LAUNCHERDESK_KB }]
      },
      contents,
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.4,
      }
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    }
  )

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text
  return text || FALLBACK_MSG
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voiceflow/interact
// ─────────────────────────────────────────────────────────────────────────────
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

    if (GEMINI_API_KEY) {
      try {
        // Pass history excluding last user message (callGemini adds it)
        const history = session.messages.slice(0, -1).map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          content: m.content,
        }))
        replyText = await callGemini(userText, history)
      } catch (err) {
        console.error('[Gemini] Error:', err.response?.data || err.message)
        replyText = FALLBACK_MSG
      }
    } else {
      console.warn('[Gemini] No GEMINI_API_KEY configured')
    }

    session.messages.push({ role: 'bot', content: replyText })

    // Auto-save lead if name + email detected
    if (!session.convertedToLead && session.leadName && session.leadEmail) {
      try {
        await Lead.create({ name: session.leadName, email: session.leadEmail, mobile: session.leadMobile, source: 'chatbot' })
        session.convertedToLead = true
      } catch (e) {
        console.warn('[Gemini] Lead create error:', e.message)
      }
    }

    await session.save()
    return res.json({ success: true, traces: buildTraces(replyText) })
  }

  return res.json({ success: true, traces: [] })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/voiceflow/session/:userId
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteSession = asyncHandler(async (req, res, next) => {
  const { userId } = req.params
  if (!userId) return next(new AppError('userId is required', 400))
  await ChatSession.deleteOne({ voiceflowUserId: userId })
  res.json({ success: true, message: 'Session cleared' })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voiceflow/sessions (admin)
// ─────────────────────────────────────────────────────────────────────────────
exports.getSessions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, converted } = req.query
  const filter = {}
  if (converted === 'true')  filter.convertedToLead = true
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