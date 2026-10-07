/**
 * Client lifecycle states, independent of the linked User account's auth
 * status (see services/clientAuthSync.service.js for how the two are kept
 * coherent).
 */
const CLIENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
});

const ALL_CLIENT_STATUSES = Object.values(CLIENT_STATUS);

/**
 * Allowed status transitions for PATCH /api/clients/:id/status. ARCHIVED
 * is reachable from any non-archived state (it is the soft-delete/archive
 * action - see DELETE /api/clients/:id) but never leaves ARCHIVED; every
 * other transition follows the brief's explicit graph.
 */
const CLIENT_STATUS_TRANSITIONS = Object.freeze({
  [CLIENT_STATUS.PENDING]: [CLIENT_STATUS.ACTIVE, CLIENT_STATUS.ARCHIVED],
  [CLIENT_STATUS.ACTIVE]: [CLIENT_STATUS.INACTIVE, CLIENT_STATUS.SUSPENDED, CLIENT_STATUS.ARCHIVED],
  [CLIENT_STATUS.INACTIVE]: [CLIENT_STATUS.ACTIVE, CLIENT_STATUS.ARCHIVED],
  [CLIENT_STATUS.SUSPENDED]: [CLIENT_STATUS.ACTIVE, CLIENT_STATUS.ARCHIVED],
  [CLIENT_STATUS.ARCHIVED]: [],
});

function isValidClientStatusTransition(from, to) {
  if (from === to) return false;
  return (CLIENT_STATUS_TRANSITIONS[from] || []).includes(to);
}

/**
 * Maps a Client's business status to the auth status the linked User
 * account should have. Only ACTIVE clients may authenticate.
 */
const CLIENT_STATUS_TO_USER_STATUS = Object.freeze({
  [CLIENT_STATUS.PENDING]: 'PENDING',
  [CLIENT_STATUS.ACTIVE]: 'ACTIVE',
  [CLIENT_STATUS.INACTIVE]: 'DISABLED',
  [CLIENT_STATUS.SUSPENDED]: 'SUSPENDED',
  [CLIENT_STATUS.ARCHIVED]: 'DISABLED',
});

module.exports = {
  CLIENT_STATUS,
  ALL_CLIENT_STATUSES,
  CLIENT_STATUS_TRANSITIONS,
  isValidClientStatusTransition,
  CLIENT_STATUS_TO_USER_STATUS,
};
