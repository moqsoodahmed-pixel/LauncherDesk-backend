const { AuditLog } = require('../../models/portal');
const logger = require('../../utils/portal/logger');
const { sanitizeMetadata } = require('../../utils/portal/sanitizeMetadata');

/**
 * Writes an audit log entry. Never throws - an audit logging failure
 * should never block the business action it is recording. Errors are
 * logged to the server console instead.
 *
 * Phase 10: metadata is passed through the centralized redaction layer
 * (utils/sanitizeMetadata.js) as defense-in-depth - callers are expected
 * to never put secrets in metadata in the first place, but this ensures a
 * future caller's mistake can never actually persist one.
 */
async function logAudit({ actor = null, actorRole = 'SYSTEM', action, resourceType = null, resourceId = null, metadata = {}, ipAddress = null, userAgent = null }) {
  try {
    await AuditLog.create({
      actor,
      actorRole,
      action,
      resourceType,
      resourceId,
      metadata: sanitizeMetadata(metadata),
      ipAddress,
      userAgent,
    });
  } catch (err) {
    logger.error('[auditLog] Failed to write audit log entry:', err.message);
  }
}

module.exports = { logAudit };
