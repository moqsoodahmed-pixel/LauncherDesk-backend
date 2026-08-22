const axios       = require('axios')
const ChatSession = require('../models/ChatSession')
const Lead        = require('../models/Lead')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

const VF_BASE    = 'https://general-runtime.voiceflow.com'
const VF_API_KEY = process.env.VOICEFLOW_API_KEY
const VF_VERSION = process.env.VOICEFLOW_VERSION_ALIAS || 'production' // or 'development'

// ── Helper: extract plain text from Voiceflow traces ─────────────────────────
function extractMessages(traces = []) {
  const messages = []
  for (const trace of traces) {
    if (trace.type === 'text' && trace.payload?.message) {
      messages.push({ role: 'bot', content: trace.payload.message, traceType: 'text' })
    } else if (trace.type === 'speak' && trace.payload?.message) {
      messages.push({ role: 'bot', content: trace.payload.message, traceType: 'speak' })
    } else if (trace.type === 'visual') {
      messages.push({ role: 'bot', content: trace.payload?.image || '[image]', traceType: 'visual' })
    }
    // 'choice', 'carousel', 'end', 'flow', 'block' traces are kept in the raw
    // response for the frontend to render — we only log text/speak here.
  }
  return messages
}

// ── Helper: check if Voiceflow responded with any capture variables ───────────
// Voiceflow sets variables via 'variables' traces. Map them to lead fields.
function extractVariables(traces = []) {
  const vars = {}
  for (const trace of traces) {
    if (trace.type === 'variables') {
      Object.assign(vars, trace.payload)
    }
  }
  return vars
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voiceflow/interact
// Body: { userId, action }
// action examples:
//   { type: 'launch' }
//   { type: 'text', payload: 'Hello' }
//   { type: 'intent', payload: { intent: { name: 'select_service' }, entities: [] } }
// ─────────────────────────────────────────────────────────────────────────────
exports.interact = asyncHandler(async (req, res, next) => {
  if (!VF_API_KEY) return next(new AppError('Voiceflow API key not configured', 500))

  const { userId, action } = req.body
  if (!userId || !action) return next(new AppError('userId and action are required', 400))

  // Forward the action to Voiceflow Runtime API
  let vfResponse
  try {
    vfResponse = await axios.post(
      `${VF_BASE}/state/user/${encodeURIComponent(userId)}/interact`,
      { action, config: { tts: false, stripSSML: true } },
      {
        headers: {
          Authorization: `Bearer ${VF_API_KEY}`,
          versionID: VF_VERSION,
          'Content-Type': 'application/json',
        },
      }
    )
  } catch (err) {
    const status  = err.response?.status || 502
    const message = err.response?.data?.message || 'Voiceflow API error'
    return next(new AppError(`Voiceflow: ${message}`, status))
  }

  const traces    = vfResponse.data   // array of trace objects
  const botMsgs   = extractMessages(traces)
  const variables = extractVariables(traces)

  // ── Persist session to MongoDB ────────────────────────────────────────────
  let session = await ChatSession.findOne({ voiceflowUserId: userId })

  if (!session) {
    session = new ChatSession({ voiceflowUserId: userId })
  }

  // Record the user's message (if it was a text action)
  if (action.type === 'text' && action.payload) {
    session.messages.push({ role: 'user', content: String(action.payload) })
  }

  // Record bot replies
  session.messages.push(...botMsgs)

  // Capture any lead variables Voiceflow collected via its capture step
  if (variables.user_name  || variables.name)   session.leadName   = variables.user_name  || variables.name
  if (variables.user_email || variables.email)  session.leadEmail  = variables.user_email || variables.email
  if (variables.user_phone || variables.mobile) session.leadMobile = variables.user_phone || variables.mobile

  // Auto-create a Lead record once we have at least name + email from the chat
  if (
    !session.convertedToLead &&
    session.leadName &&
    session.leadEmail
  ) {
    await Lead.create({
      name:           session.leadName,
      email:          session.leadEmail,
      mobile:         session.leadMobile,
      source:         'voiceflow-chatbot',
      serviceInterest: variables.service_interest || variables.selected_service,
    })
    session.convertedToLead = true
  }

  await session.save()

  // Return the raw Voiceflow traces to the frontend so it can render
  // choices, carousels, buttons, etc. exactly as Voiceflow intended.
  res.json({ success: true, traces })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/voiceflow/session/:userId
// Clears the Voiceflow runtime state so the next interact starts fresh.
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteSession = asyncHandler(async (req, res, next) => {
  if (!VF_API_KEY) return next(new AppError('Voiceflow API key not configured', 500))

  const { userId } = req.params
  if (!userId) return next(new AppError('userId is required', 400))

  try {
    await axios.delete(
      `${VF_BASE}/state/user/${encodeURIComponent(userId)}`,
      { headers: { Authorization: VF_API_KEY, versionID: VF_VERSION } }
    )
  } catch (err) {
    // If Voiceflow returns 404 (session didn't exist), that's fine — just continue
    if (err.response?.status !== 404) {
      return next(new AppError('Failed to clear Voiceflow session', 502))
    }
  }

  res.json({ success: true, message: 'Session cleared' })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voiceflow/sessions  (admin only)
// Lists all persisted chat sessions from MongoDB.
// ─────────────────────────────────────────────────────────────────────────────
exports.getSessions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, converted } = req.query
  const filter = {}
  if (converted === 'true')  filter.convertedToLead = true
  if (converted === 'false') filter.convertedToLead = false

  const skip = (Number(page) - 1) * Number(limit)
  const [sessions, total] = await Promise.all([
    ChatSession.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('user', 'name email'),
    ChatSession.countDocuments(filter),
  ])

  res.json({ success: true, total, page: Number(page), data: sessions })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voiceflow/sessions/:userId  (admin only)
// Full message history for a specific session.
// ─────────────────────────────────────────────────────────────────────────────
exports.getSession = asyncHandler(async (req, res, next) => {
  const session = await ChatSession.findOne({ voiceflowUserId: req.params.userId }).populate('user', 'name email')
  if (!session) return next(new AppError('Session not found', 404))
  res.json({ success: true, data: session })
})