/**
 * Service lifecycle. ARCHIVED is a deliberate, terminal long-term state -
 * once archived a service can never be reactivated (a fresh service should
 * be created instead if the offering returns). ACTIVE and INACTIVE freely
 * toggle back and forth; INACTIVE simply hides a service from normal
 * selection without discarding it.
 */
const SERVICE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
});

const ALL_SERVICE_STATUSES = Object.values(SERVICE_STATUS);

const SERVICE_STATUS_TRANSITIONS = Object.freeze({
  [SERVICE_STATUS.ACTIVE]: [SERVICE_STATUS.INACTIVE, SERVICE_STATUS.COMPLETED, SERVICE_STATUS.ARCHIVED],
  [SERVICE_STATUS.INACTIVE]: [SERVICE_STATUS.ACTIVE, SERVICE_STATUS.COMPLETED, SERVICE_STATUS.ARCHIVED],
  [SERVICE_STATUS.COMPLETED]: [SERVICE_STATUS.ARCHIVED],
  [SERVICE_STATUS.ARCHIVED]: [],
});

function isValidServiceStatusTransition(from, to) {
  if (from === to) return false;
  return (SERVICE_STATUS_TRANSITIONS[from] || []).includes(to);
}

module.exports = { SERVICE_STATUS, ALL_SERVICE_STATUSES, SERVICE_STATUS_TRANSITIONS, isValidServiceStatusTransition };
