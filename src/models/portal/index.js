/**
 * Central export so other modules can `require('../../models/portal')` instead of
 * importing each file individually.
 */
module.exports = {
  User: require('./User.model'),
  Client: require('./Client.model'),
  ClientAssignmentHistory: require('./ClientAssignmentHistory.model'),
  Service: require('./Service.model'),
  Order: require('./Order.model'),
  OrderStatusHistory: require('./OrderStatusHistory.model'),
  OrderAssignmentHistory: require('./OrderAssignmentHistory.model'),
  Counter: require('./Counter.model'),
  Payment: require('./Payment.model'),
  PaymentWebhookEvent: require('./PaymentWebhookEvent.model'),
  KycDocument: require('./KycDocument.model'),
  Invoice: require('./Invoice.model'),
  KycVerification: require('./KycVerification.model'),
  Notification: require('./Notification.model'),
  AuditLog: require('./AuditLog.model'),
  RefreshToken: require('./RefreshToken.model'),
  PasswordResetToken: require('./PasswordResetToken.model'),
  // Phase 0's EmailLog model, extended in Phase 9 into a unified
  // channel-agnostic communication log/outbox (see the model file's own
  // doc-comment) - same file/collection, exported under its new name.
  CommunicationLog: require('./EmailLog.model'),
  SystemSetting: require('./SystemSetting.model'),
  Task: require('./Task.model'),
  SupportTicket: require('./SupportTicket.model'),
  InternalNote: require('./InternalNote.model'),
  DocRequest: require('./DocRequest.model'),
  Announcement: require('./Announcement.model'),
  // Part 5 enterprise KYC additions
  KycOcrData: require('./KycOcrData.model'),
  KycComment: require('./KycComment.model'),
};
