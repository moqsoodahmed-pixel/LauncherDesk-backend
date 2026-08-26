const axios       = require('axios')
const ChatSession = require('../models/ChatSession')
const Lead        = require('../models/Lead')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

const VF_BASE    = 'https://general-runtime.voiceflow.com'
const VF_API_KEY = process.env.VOICEFLOW_API_KEY
const VF_VERSION = process.env.VOICEFLOW_VERSION_ALIAS || 'production'

// ── Extract plain text from Voiceflow traces ──────────────────────────────────
function extractMessages(traces = []) {
  const messages = []
  for (const trace of traces) {
    if ((trace.type === 'text' || trace.type === 'speak') && trace.payload?.message) {
      messages.push({ role: 'bot', content: trace.payload.message, traceType: trace.type })
    }
  }
  return messages
}

function extractVariables(traces = []) {
  const vars = {}
  for (const trace of traces) {
    if (trace.type === 'variables') Object.assign(vars, trace.payload)
  }
  return vars
}

function buildTraces(text) {
  return [{ type: 'text', payload: { message: text } }]
}

const FALLBACK_MSG = "Hi! I'm the LauncherDesk AI — your business manager. I can help with company registration, GST, trademark, websites, digital marketing, virtual office, compliance and more. Please WhatsApp us at +91 85488 54859 for immediate assistance."

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voiceflow/interact
// ─────────────────────────────────────────────────────────────────────────────
exports.interact = asyncHandler(async (req, res, next) => {
  const { userId, action } = req.body
  if (!userId || !action) return next(new AppError('userId and action are required', 400))

  // Load or create session
  let session = await ChatSession.findOne({ voiceflowUserId: userId })
  if (!session) session = new ChatSession({ voiceflowUserId: userId })

  // ── LAUNCH ────────────────────────────────────────────────────────────────
  if (action.type === 'launch') {
    const greeting = "Hi! I'm the LauncherDesk AI — your business manager. I can help you with company registration, GST, trademark, websites, digital marketing, virtual office, compliance and more. What does your business need today?"

    // Try to launch Voiceflow session too
    if (VF_API_KEY) {
      try {
        await axios.post(
          `${VF_BASE}/state/user/${encodeURIComponent(userId)}/interact`,
          { action: { type: 'launch' }, config: { tts: false, stripSSML: true } },
          { headers: { Authorization: `Bearer ${VF_API_KEY}`, versionID: VF_VERSION, 'Content-Type': 'application/json' }, timeout: 8000 }
        )
      } catch (err) {
        console.warn('Voiceflow launch error:', err.message)
      }
    }

    session.messages.push({ role: 'bot', content: greeting })
    await session.save()
    return res.json({ success: true, traces: buildTraces(greeting) })
  }

  // ── TEXT ──────────────────────────────────────────────────────────────────
  if (action.type === 'text' && action.payload) {
    const userText = String(action.payload)
    session.messages.push({ role: 'user', content: userText })

    let replyText = null

    // Try Voiceflow
    if (VF_API_KEY) {
      try {
        const vfResponse = await axios.post(
          `${VF_BASE}/state/user/${encodeURIComponent(userId)}/interact`,
          { action: { type: 'text', payload: userText }, config: { tts: false, stripSSML: true } },
          { headers: { Authorization: `Bearer ${VF_API_KEY}`, versionID: VF_VERSION, 'Content-Type': 'application/json' }, timeout: 10000 }
        )
        const vfTraces  = vfResponse.data
        const vfMsgs    = extractMessages(vfTraces)
        const variables = extractVariables(vfTraces)

        if (variables.user_name  || variables.name)   session.leadName   = variables.user_name  || variables.name
        if (variables.user_email || variables.email)  session.leadEmail  = variables.user_email || variables.email
        if (variables.user_phone || variables.mobile) session.leadMobile = variables.user_phone || variables.mobile

        const vfText = vfMsgs.map(m => m.content).join('\n\n')
        if (vfText) replyText = vfText
      } catch (err) {
        console.warn('Voiceflow text error:', err.message)
      }
    }

    // Fallback if Voiceflow not configured or failed
    if (!replyText) {
      replyText = FALLBACK_MSG
    }

    session.messages.push({ role: 'bot', content: replyText })

    // Auto-create Lead if we captured name + email
    if (!session.convertedToLead && session.leadName && session.leadEmail) {
      try {
        await Lead.create({ name: session.leadName, email: session.leadEmail, mobile: session.leadMobile, source: 'chatbot' })
        session.convertedToLead = true
      } catch (e) {
        console.warn('Lead create error:', e.message)
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

  if (VF_API_KEY) {
    try {
      await axios.delete(
        `${VF_BASE}/state/user/${encodeURIComponent(userId)}`,
        { headers: { Authorization: VF_API_KEY, versionID: VF_VERSION } }
      )
    } catch (err) {
      if (err.response?.status !== 404) console.warn('VF session delete error:', err.message)
    }
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voiceflow/sessions/:userId (admin)
// ─────────────────────────────────────────────────────────────────────────────
exports.getSession = asyncHandler(async (req, res, next) => {
  const session = await ChatSession.findOne({ voiceflowUserId: req.params.userId })
  if (!session) return next(new AppError('Session not found', 404))
  res.json({ success: true, data: session })
})