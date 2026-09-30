const axios = require('axios')
const mongoose = require('mongoose')
const ChatSession = require('../models/ChatSession')
const Lead = require('../models/Lead')
const User = require('../models/User')
const Payment = require('../models/Payment')
const { asyncHandler, AppError } = require('../middleware/errorHandler')
const { LAUNCHERDESK_KB } = require('../data/knowledgeBase')

/**
 * AI backend: Powered by Groq (openai/gpt-oss-120b)
 * Fast, free, high-performance conversational business assistant
 */
const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const PRIMARY_MODEL = 'openai/gpt-oss-120b'
const FALLBACK_MODEL = 'openai/gpt-oss-20b'

const FALLBACK_MSG = "Hi! I'm Sneha from LauncherDesk. How can I help your business today? Feel free to ask about our services, pricing, or message us on WhatsApp at +91 85488 54859."

function buildTraces(text) {
  return [{ type: 'text', payload: { message: text } }]
}

async function callGroqSingle(model, messages, groqKey) {
  const payload = {
    model,
    messages,
    max_completion_tokens: 500,
    temperature: 0.4,
  }
  if (model === PRIMARY_MODEL) {
    payload.reasoning_effort = 'low'
  }

  const response = await axios.post(
    GROQ_URL,
    payload,
    {
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  )

  return response.data?.choices?.[0]?.message?.content?.trim() || null
}

async function callGroq(userMessage, history = []) {
  const groqKey = process.env.GROQ_API_KEY || GROQ_API_KEY
  if (!groqKey) return null

  const messages = [{ role: 'system', content: LAUNCHERDESK_KB }]
  for (const msg of history.slice(-6)) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })
  }
  messages.push({ role: 'user', content: userMessage })

  // Try primary 120b
  try {
    const text = await callGroqSingle(PRIMARY_MODEL, messages, groqKey)
    if (text) return text
  } catch (err) {
    console.warn(`[Groq] ${PRIMARY_MODEL} error:`, err.response?.status, err.response?.data?.error?.message || err.message)
  }

  // Fallback to 20b
  try {
    const text = await callGroqSingle(FALLBACK_MODEL, messages, groqKey)
    if (text) return text
  } catch (err2) {
    console.warn(`[Groq] ${FALLBACK_MODEL} error:`, err2.response?.status, err2.response?.data?.error?.message || err2.message)
  }

  return null
}

exports.interact = asyncHandler(async (req, res, next) => {
  const { userId, action } = req.body
  if (!userId || !action) return next(new AppError('userId and action are required', 400))

  let session = await ChatSession.findOne({ voiceflowUserId: userId })
  if (!session) session = new ChatSession({ voiceflowUserId: userId })

  // Link this chat to the logged-in customer (used by the admin Chat History page)
  const chatUser = req.user || null   // set by protect() on POST /interact
  if (chatUser) {
    if (!session.user) session.user = chatUser._id
    if (!session.leadName)   session.leadName   = chatUser.name
    if (!session.leadEmail)  session.leadEmail  = chatUser.email
    if (!session.leadMobile && chatUser.phone) session.leadMobile = chatUser.phone
  }

  if (action.type === 'launch') {
    const greeting = "Hi! I'm Sneha, your LauncherDesk business assistant. How can I help you today?"
    session.messages.push({ role: 'bot', content: greeting })
    await session.save()
    return res.json({ success: true, traces: buildTraces(greeting) })
  }

  if (action.type === 'text' && action.payload) {
    const userText = String(action.payload)
    session.messages.push({ role: 'user', content: userText })

    let replyText = null
    const history = session.messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }))

    const groqKey = process.env.GROQ_API_KEY || GROQ_API_KEY

    if (groqKey) {
      try {
        replyText = await callGroq(userText, history)
        if (replyText) console.log('[Groq] ✓ Response received')
      } catch (err) {
        console.error('[Groq] Failed:', err.response?.status, err.response?.data?.error?.message || err.message)
      }
    } else {
      console.warn('[Groq] No GROQ_API_KEY configured')
    }

    if (!replyText) {
      replyText = FALLBACK_MSG
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

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * GET /api/voiceflow/sessions   (admin only)
 * Query: page, limit, q, converted=true|false, linked=true|false
 * `q` searches: chat id, name/email/mobile, message text, customer name/email/phone,
 *               and Razorpay payment / order ids (pay_xxx / order_xxx).
 */
exports.getSessions = asyncHandler(async (req, res) => {
  const page  = Math.max(parseInt(req.query.page, 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50)
  const { converted, linked, q } = req.query

  const filter = {}
  if (converted === 'true')  filter.convertedToLead = true
  if (converted === 'false') filter.convertedToLead = false
  if (linked === 'true')     filter.user = { $ne: null }
  if (linked === 'false')    filter.user = null

  const term = (q || '').trim()
  if (term) {
    const rx = new RegExp(escapeRegex(term), 'i')
    const or = [
      { voiceflowUserId: rx },
      { leadName: rx }, { leadEmail: rx }, { leadMobile: rx },
      { 'messages.content': rx },
    ]
    if (mongoose.isValidObjectId(term)) or.push({ user: term }, { _id: term })

    // customers matching the term, and customers who own a matching payment
    const [users, payments] = await Promise.all([
      User.find({ $or: [{ name: rx }, { email: rx }, { phone: rx }] }).select('_id').limit(50).lean(),
      Payment.find({ $or: [{ razorpayPaymentId: rx }, { razorpayOrderId: rx }] }).select('user').limit(50).lean(),
    ])
    const ids = [...users.map(u => u._id), ...payments.map(p => p.user)]
    if (ids.length) or.push({ user: { $in: ids } })
    filter.$or = or
  }

  const [rows, total] = await Promise.all([
    ChatSession.aggregate([
      { $match: filter },
      { $sort: { updatedAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $project: {
          voiceflowUserId: 1, user: 1, leadName: 1, leadEmail: 1, leadMobile: 1,
          convertedToLead: 1, createdAt: 1, updatedAt: 1,
          messageCount: { $size: { $ifNull: ['$messages', []] } },
          lastMessage: { $arrayElemAt: ['$messages', -1] },
      } },
    ]),
    ChatSession.countDocuments(filter),
  ])

  await User.populate(rows, { path: 'user', select: 'name email phone' })
  res.json({ success: true, total, page, data: rows })
})

/**
 * GET /api/voiceflow/sessions/:id   (admin only)
 * `:id` can be the chat document _id, the voiceflowUserId, or a customer's user _id.
 * Returns the full transcript plus the customer's payments (if the chat is linked to a user).
 */
exports.getSession = asyncHandler(async (req, res, next) => {
  const { userId: key } = req.params
  const lookups = [{ voiceflowUserId: key }]
  if (mongoose.isValidObjectId(key)) lookups.push({ _id: key }, { user: key })

  const session = await ChatSession.findOne({ $or: lookups })
    .sort({ updatedAt: -1 })
    .populate('user', 'name email phone createdAt')
  if (!session) return next(new AppError('Session not found', 404))

  let payments = []
  if (session.user) {
    payments = await Payment.find({ user: session.user._id })
      .sort({ createdAt: -1 })
      .select('razorpayOrderId razorpayPaymentId serviceTitle amountRupees currency status verifiedAt createdAt')
      .lean()
  }
  res.json({ success: true, data: session, payments })
})

/**
 * DELETE /api/voiceflow/sessions/:id   (admin only)
 */
exports.adminDeleteSession = asyncHandler(async (req, res, next) => {
  const { userId: key } = req.params
  const lookups = [{ voiceflowUserId: key }]
  if (mongoose.isValidObjectId(key)) lookups.push({ _id: key })
  const r = await ChatSession.deleteOne({ $or: lookups })
  if (!r.deletedCount) return next(new AppError('Session not found', 404))
  res.json({ success: true, message: 'Chat deleted' })
})
