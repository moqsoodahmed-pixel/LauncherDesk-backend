const mongoose = require('mongoose')

const messageSchema = new mongoose.Schema(
  {
    role:    { type: String, enum: ['user', 'bot'], required: true },
    content: { type: String, required: true },
    // Voiceflow can return traces of different types (text, visual, choice, etc.)
    traceType: { type: String },
  },
  { _id: false }
)

const chatSessionSchema = new mongoose.Schema(
  {
    // Voiceflow uses a userID string to track sessions — store it here
    voiceflowUserId: { type: String, required: true, index: true },
    // Optional: link to a registered user if they are logged in
    user:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Captured lead info if the chatbot collects it mid-conversation
    leadName:   { type: String },
    leadEmail:  { type: String },
    leadMobile: { type: String },
    messages:   [messageSchema],
    // Whether we've already created a Lead/Contact record from this session
    convertedToLead: { type: Boolean, default: false },
    // Last known Voiceflow state (optional, useful for resuming sessions)
    lastState: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
)

module.exports = mongoose.model('ChatSession', chatSessionSchema)