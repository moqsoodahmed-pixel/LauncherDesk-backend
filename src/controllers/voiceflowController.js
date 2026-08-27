const axios       = require('axios')
const ChatSession = require('../models/ChatSession')
const Lead        = require('../models/Lead')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { LAUNCHERDESK_KB } = require('../data/knowledgeBase')

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions'

const FALLBACK_MSG = "Hi! I'm the LauncherDesk AI. I can help with company registration, GST, trademark, websites, digital marketing, virtual office and compliance. Please WhatsApp us at +91 85488 54859 for immediate assistance."

function buildTraces(text) {
  return [{ type: 'text', payload: { message: text } }]
}

async function callGroq(userMessage, history = []) {
  const messages = [
    { role: 'system', content: LAUNCHERDESK_KB }
  ]

  // Add conversation history (last 8 messages)
  for (const msg of history.slice(-8)) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    })
  }

  // Add current user message
  messages.push({ role: 'user', content: userMessage })

  const response = await axios.post(
    GROQ_URL,
    {
      model: 'llama-3.1-8b-instant',  // Current free model on Groq
      messages,
      max_tokens: 500,
      temperature: 0.4,
    },
    {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )

  const text = response.data?.choices?.[0]?.message?.content
  return text || FALLBACK_MSG
}

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

    if (GROQ_API_KEY) {
      try {
        const history = session.messages.slice(0, -1).map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        }))
        replyText = await callGroq(userText, history)
        console.log('[Groq] ✓ Response received')
      } catch (err) {
        console.error('[Groq] Error:', err.response?.status, JSON.stringify(err.response?.data || err.message))
      }
    } else {
      console.warn('[Groq] No GROQ_API_KEY set')
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