const mongoose = require('mongoose');

const TICKET_STATUSES = Object.freeze(['OPEN', 'WAITING', 'RESOLVED', 'CLOSED']);
const TICKET_PRIORITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const SENDER_TYPES = Object.freeze(['CLIENT', 'ADMIN']);

const messageSchema = new mongoose.Schema(
  {
    body: { type: String, required: true, trim: true },
    senderType: { type: String, enum: SENDER_TYPES, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, required: true },
    senderName: { type: String },
  },
  { timestamps: true, collection: 'portal_support_tickets' }
);

const supportTicketSchema = new mongoose.Schema(
  {
    ticketCode: { type: String, unique: true, sparse: true, index: true },
    ticketId: { type: String, sparse: true, index: true },
    legacyTicketCode: { type: String, default: null, index: true },
    legacyTicketId: { type: String, default: null, index: true },
    legacyCode: { type: String, default: null, index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'PortalClient', required: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'PortalOrder', default: null },
    subject: { type: String, required: true, trim: true },
    status: { type: String, enum: TICKET_STATUSES, default: 'OPEN', index: true },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'MEDIUM' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'PortalUser', default: null },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
    messages: [messageSchema],
  },
  { timestamps: true, collection: 'portal_support_tickets' }
);

supportTicketSchema.index({ client: 1, status: 1 });
supportTicketSchema.index({ status: 1, priority: 1 });

module.exports = mongoose.model('PortalSupportTicket', supportTicketSchema);
module.exports.TICKET_STATUSES = TICKET_STATUSES;
module.exports.TICKET_PRIORITIES = TICKET_PRIORITIES;
