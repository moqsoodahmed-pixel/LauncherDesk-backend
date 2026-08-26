const axios       = require('axios')
const Anthropic   = require('@anthropic-ai/sdk')
const ChatSession = require('../models/ChatSession')
const Lead        = require('../models/Lead')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { LAUNCHERDESK_KB, LAUNCHERDESK_KB_SHORT } = require('../data/knowledgeBase')

const VF_BASE    = 'https://general-runtime.voiceflow.com'
const VF_API_KEY = process.env.VOICEFLOW_API_KEY
const VF_VERSION = process.env.VOICEFLOW_VERSION_ALIAS || 'production'

// Anthropic client — uses ANTHROPIC_API_KEY from env
const anthropic = new Anthropic()

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

// ── Detect if Voiceflow gave a useless/generic response ──────────────────────
function isGenericResponse(text = '') {
  const lower = text.toLowerCase()
  const genericPhrases = [
    'acme corp',
    'i\'m set up to help with',
    'falls outside what i can',
    'can\'t assist with that',
    'i cannot help with',
    'outside my scope',
    'not able to help',
    'i don\'t have information',
    'please contact our support',
    'beyond my capabilities',
    'not trained to',
    'i\'m only able to',
  ]
  return genericPhrases.some(p => lower.includes(p))
}

// ── Build synthetic Voiceflow-style traces from Claude text ───────────────────
function buildClaudeTraces(text) {
  return [{ type: 'text', payload: { message: text } }]
}

// ── Call Claude with full LauncherDesk knowledge ─────────────────────────────
async function callClaude(userMessage, conversationHistory = []) {
  // Build messages array from history + new message
  const messages = []

  // Add prior turns
  for (const turn of conversationHistory) {
    if (turn.role === 'user') {
      messages.push({ role: 'user', content: turn.content })
    } else if (turn.role === 'bot' || turn.role === 'assistant') {
      messages.push({ role: 'assistant', content: turn.content })
    }
  }

  // Add current user message
  messages.push({ role: 'user', content: userMessage })

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: LAUNCHERDESK_KB,
    messages,
  })

  return response.content[0]?.text || "I'm here to help! Could you tell me more about what you need?"
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voiceflow/interact
// ─────────────────────────────────────────────────────────────────────────────
exports.interact = asyncHandler(async (req, res, next) => {
  const { userId, action } = req.body
  if (!userId || !action) return next(new AppError('userId and action are required', 400))

  // Load or create session from DB (for conversation history)
  let session = await ChatSession.findOne({ voiceflowUserId: userId })
  if (!session) session = new ChatSession({ voiceflowUserId: userId })

  // ── LAUNCH action: always reply with Claude greeting ─────────────────────
  if (action.type === 'launch') {
    const greeting = "Hi! I'm the LauncherDesk AI — your business manager. I can help you with company registration, GST, trademark, websites, digital marketing, virtual office, compliance and more. What does your business need today?"
    const traces = buildClaudeTraces(greeting)
    session.messages.push({ role: 'bot', content: greeting })
    await session.save()
    return res.json({ success: true, traces })
  }

  // ── TEXT action ───────────────────────────────────────────────────────────
  if (action.type === 'text' && action.payload) {
    const userText = String(action.payload)

    // Save user message to session
    session.messages.push({ role: 'user', content: userText })

    let replyText = null
    let usedVoiceflow = false

    // Try Voiceflow first if API key is configured
    if (VF_API_KEY) {
      try {
        const vfResponse = await axios.post(
          `${VF_BASE}/state/user/${encodeURIComponent(userId)}/interact`,
          {
            action: { type: 'text', payload: userText },
            config: {
              tts: false,
              stripSSML: true,
              variables: { kb_context: LAUNCHERDESK_KB_SHORT },
            },
          },
          {
            headers: {
              Authorization: `Bearer ${VF_API_KEY}`,
              versionID: VF_VERSION,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        )

        const vfTraces  = vfResponse.data
        const vfMsgs    = extractMessages(vfTraces)
        const variables = extractVariables(vfTraces)

        // Capture lead variables from Voiceflow
        if (variables.user_name  || variables.name)   session.leadName   = variables.user_name  || variables.name
        if (variables.user_email || variables.email)  session.leadEmail  = variables.user_email || variables.email
        if (variables.user_phone || variables.mobile) session.leadMobile = variables.user_phone || variables.mobile

        const vfText = vfMsgs.map(m => m.content).join('\n\n')

        // Use Voiceflow response ONLY if it's not generic/useless
        if (vfText && !isGenericResponse(vfText)) {
          replyText = vfText
          usedVoiceflow = true
        }
      } catch (err) {
        // Voiceflow failed — fall through to Claude
        console.warn('Voiceflow error, falling back to Claude:', err.message)
      }
    }

    // Fall back to Claude if Voiceflow didn't give a good answer
    if (!replyText) {
      try {
        // Pass last 10 messages as conversation history for context
        const history = session.messages.slice(-10).map(m => ({
          role: m.role === 'user' ? 'user' : 'bot',
          content: m.content,
        }))
        // Remove the last message (current user message) since callClaude adds it
        const historyWithoutLast = history.slice(0, -1)
        replyText = await callClaude(userText, historyWithoutLast)
      } catch (claudeErr) {
        console.error('Claude error:', claudeErr.message)
        replyText = "I'm having a brief connection issue. Please try again or WhatsApp us directly at +91 85488 54859 for immediate help."
      }
    }

    // Save bot reply to session
    session.messages.push({ role: 'bot', content: replyText })

    // Auto-create Lead record if we have name + email
    if (!session.convertedToLead && session.leadName && session.leadEmail) {
      await Lead.create({
        name:   session.leadName,
        email:  session.leadEmail,
        mobile: session.leadMobile,
        source: 'chatbot',
      })
      session.convertedToLead = true
    }

    await session.save()

    const traces = buildClaudeTraces(replyText)
    return res.json({ success: true, traces })
  }

  // ── Any other action type — just acknowledge ──────────────────────────────
  return res.json({ success: true, traces: [] })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/voiceflow/session/:userId
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteSession = asyncHandler(async (req, res, next) => {
  const { userId } = req.params
  if (!userId) return next(new AppError('userId is required', 400))

  // Clear Voiceflow session if configured
  if (VF_API_KEY) {
    try {
      await axios.delete(
        `${VF_BASE}/state/user/${encodeURIComponent(userId)}`,
        { headers: { Authorization: VF_API_KEY, versionID: VF_VERSION } }
      )
    } catch (err) {
      if (err.response?.status !== 404) {
        console.warn('Failed to clear Voiceflow session:', err.message)
      }
    }
  }

  await ChatSession.deleteOne({ voiceflowUserId: userId })
  res.json({ success: true, message: 'Session cleared' })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voiceflow/sessions  (admin)
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
// GET /api/voiceflow/sessions/:userId  (admin)
// ─────────────────────────────────────────────────────────────────────────────
exports.getSession = asyncHandler(async (req, res, next) => {
  const session = await ChatSession.findOne({ voiceflowUserId: req.params.userId })
  if (!session) return next(new AppError('Session not found', 404))
  res.json({ success: true, data: session })
})