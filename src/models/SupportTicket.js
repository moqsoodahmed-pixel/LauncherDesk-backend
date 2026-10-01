const mongoose = require('mongoose')

const supportTicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true },   // LD-TKT-12345
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order:    { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceOrder' },
    subject:  { type: String, required: true },
    status:   { type: String, enum: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'], default: 'OPEN', index: true },
    messages: [{
      from:      { type: String, enum: ['customer', 'support'], required: true },
      author:    String,
      body:      { type: String, required: true },
      internal:  { type: Boolean, default: false },   // internal notes are never emailed or shown to customers
      createdAt: { type: Date, default: Date.now },
    }],
    resolvedAt: Date,
  },
  { timestamps: true }
)

module.exports = mongoose.model('SupportTicket', supportTicketSchema)
