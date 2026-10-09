/**
 * Centralized in-app notification event catalogue. Distinct from
 * constants/communicationEvents.js (Phase 9, which drives EMAIL/WHATSAPP/SMS)
 * even where the string values overlap - a notification is an in-app,
 * per-user record, a communication is an external provider send; they are
 * dispatched from the same business events but are not the same system.
 */
const NOTIFICATION_EVENT = Object.freeze({
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_PAYMENT_PENDING: 'ORDER_PAYMENT_PENDING',
  ORDER_PAYMENT_CONFIRMED: 'ORDER_PAYMENT_CONFIRMED',
  ORDER_PAYMENT_FAILED: 'ORDER_PAYMENT_FAILED',
  ORDER_ASSIGNED: 'ORDER_ASSIGNED',
  ORDER_REASSIGNED: 'ORDER_REASSIGNED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_COMPLETED: 'ORDER_COMPLETED',
  ORDER_CLOSED: 'ORDER_CLOSED',

  KYC_SUBMITTED: 'KYC_SUBMITTED',
  KYC_REJECTED: 'KYC_REJECTED',
  KYC_VERIFIED: 'KYC_VERIFIED',
  KYC_DOCUMENT_REJECTED: 'KYC_DOCUMENT_REJECTED',
  // Wave 2 additions (additive) - see notificationEvents.service.js.
  KYC_DOCUMENT_NEED_REUPLOAD: 'KYC_DOCUMENT_NEED_REUPLOAD',
  KYC_REVIEWER_ASSIGNED: 'KYC_REVIEWER_ASSIGNED',

  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',

  CLIENT_CREATED: 'CLIENT_CREATED',
  CLIENT_UPDATED: 'CLIENT_UPDATED',
  CLIENT_STATUS_CHANGED: 'CLIENT_STATUS_CHANGED',

  ADMIN_CREATED: 'ADMIN_CREATED',
  ADMIN_UPDATED: 'ADMIN_UPDATED',
  ADMIN_DISABLED: 'ADMIN_DISABLED',
  ADMIN_ENABLED: 'ADMIN_ENABLED',

  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  SECURITY_EVENT: 'SECURITY_EVENT',

  DOC_REQUESTED: 'DOC_REQUESTED',
  DOC_FULFILLED: 'DOC_FULFILLED',
  TASK_ASSIGNED: 'TASK_ASSIGNED',

  SUPPORT_TICKET_CREATED: 'SUPPORT_TICKET_CREATED',
  INVOICE_GENERATION_FAILED: 'INVOICE_GENERATION_FAILED',
  EMAIL_DELIVERY_FAILED: 'EMAIL_DELIVERY_FAILED',

  // Phase 11 (smart notification) additions - additive only.
  // Fired to Super Admins when a payment is confirmed on an order with no
  // assigned admin; "resolved" once an admin is actually assigned (see
  // Notification.model.js's resolved/resolvedAt fields).
  ORDER_PAID_AWAITING_ASSIGNMENT: 'ORDER_PAID_AWAITING_ASSIGNMENT',
  // Fired to the admin when they are assigned to an order that was ALREADY
  // paid at assignment time - distinct from the generic ORDER_ASSIGNED
  // event, which fires for every assignment regardless of payment state.
  ORDER_PAID_ADMIN_ASSIGNED: 'ORDER_PAID_ADMIN_ASSIGNED',
  // Admin-facing only - a detected virus/malware upload is an internal
  // security event, never surfaced to the client who uploaded it.
  VIRUS_DETECTED: 'VIRUS_DETECTED',
});

const ALL_NOTIFICATION_EVENTS = Object.values(NOTIFICATION_EVENT);

// Security-critical events a recipient can never suppress via preferences
// (Phase 10 Part J) - checked by notification.service.js before honoring
// any "in-app notifications disabled" preference.
const MANDATORY_NOTIFICATION_EVENTS = [NOTIFICATION_EVENT.PASSWORD_CHANGED, NOTIFICATION_EVENT.SECURITY_EVENT];

module.exports = { NOTIFICATION_EVENT, ALL_NOTIFICATION_EVENTS, MANDATORY_NOTIFICATION_EVENTS };
