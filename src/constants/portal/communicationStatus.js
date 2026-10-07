/**
 * Status of one communication delivery record. This model doubles as the
 * database-backed outbox/queue (see services/communicationProcessor.service.js) -
 * there is deliberately no separate "CommunicationDelivery" collection,
 * since a single record already carries both "what was queued" and
 * "what happened to it".
 */
const COMMUNICATION_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT', // provider accepted it - NOT the same as provider-confirmed delivery
  DELIVERED: 'DELIVERED', // only ever set if a provider explicitly confirms delivery
  FAILED: 'FAILED', // terminal - permanent failure or retries exhausted
  RETRYING: 'RETRYING',
  CANCELLED: 'CANCELLED',
});

const ALL_COMMUNICATION_STATUSES = Object.values(COMMUNICATION_STATUS);

const TERMINAL_COMMUNICATION_STATUSES = [COMMUNICATION_STATUS.SENT, COMMUNICATION_STATUS.DELIVERED, COMMUNICATION_STATUS.FAILED, COMMUNICATION_STATUS.CANCELLED];

module.exports = { COMMUNICATION_STATUS, ALL_COMMUNICATION_STATUSES, TERMINAL_COMMUNICATION_STATUSES };
