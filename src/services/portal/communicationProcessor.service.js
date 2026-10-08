const { CommunicationLog } = require('../../models/portal');
const { COMMUNICATION_CHANNEL } = require('../../constants/portal/communicationChannels');
const { COMMUNICATION_STATUS } = require('../../constants/portal/communicationStatus');
const { getTemplate } = require('../../communication/templates');
const { renderTemplate } = require('../../communication/renderTemplate');
const { wrapEmailLayout } = require('../../communication/emailLayout');
const { getEmailProvider } = require('../../adapters/email');
const { getPrivateDocument } = require('./documentStorage.service');
const { getWhatsAppProvider, getSmsProvider } = require('../../adapters/whatsapp');
const { normalizeProviderError } = require('./providerError.service');
const { logAudit } = require('./auditLog.service');
const notificationEventsService = require('./notificationEvents.service');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');

/** Exponential backoff, capped at 30 minutes, keyed off how many attempts have already happened. */
function computeNextAttemptDelayMs(attemptCount) {
  const minutes = Math.min(30, 2 ** Math.max(0, attemptCount - 1));
  return minutes * 60 * 1000;
}

async function sendViaProvider(log) {
  const template = getTemplate(log.eventType);
  const channelTemplate = template?.channels?.[log.channel.toLowerCase()];
  if (!channelTemplate) {
    throw Object.assign(new Error(`No ${log.channel} template configured for event ${log.eventType}.`), { status: 400 });
  }

  if (log.channel === COMMUNICATION_CHANNEL.EMAIL) {
    const provider = getEmailProvider();
    const subject = renderTemplate(channelTemplate.subject, log.variables);
    // Every outbound email goes through the same branded header/footer wrapper
    // here, in the one place that actually sends - templates in templates.js
    // only ever author their own inner content, never the surrounding chrome.
    const html = wrapEmailLayout(renderTemplate(channelTemplate.html, log.variables, { escapeHtml: true }));

    let attachments;
    if (log.attachmentStorageKey) {
      // Re-read from the storage adapter on every send/retry rather than
      // caching bytes on the log document itself (CommunicationLog's own
      // rule: never store raw file contents) - a retry always attaches the
      // real, current file.
      const buffer = await getPrivateDocument(log.attachmentStorageKey);
      attachments = [{ filename: log.attachmentFileName || 'attachment.pdf', content: buffer }];
    }

    return provider.send({ to: log.to, subject, html, templateKey: log.eventType, attachments });
  }
  if (log.channel === COMMUNICATION_CHANNEL.WHATSAPP) {
    const provider = getWhatsAppProvider();
    return provider.send({ to: log.to, templateKey: log.eventType, variables: log.variables });
  }
  if (log.channel === COMMUNICATION_CHANNEL.SMS) {
    const provider = getSmsProvider();
    return provider.sendSms({ to: log.to, templateKey: log.eventType, variables: log.variables });
  }
  throw Object.assign(new Error(`Unknown channel: ${log.channel}`), { status: 400 });
}

/**
 * Attempts delivery of exactly one queued/retrying record. Atomically
 * "claims" it first (findOneAndUpdate on status QUEUED/RETRYING -> SENDING)
 * so two processors (or an immediate dispatch-time attempt racing a
 * scheduled batch run) can never both send the same logical message -
 * whichever claim loses finds nothing to update and returns immediately.
 * Never throws - all outcomes are recorded on the document itself.
 */
async function attemptDelivery(logId) {
  const claimed = await CommunicationLog.findOneAndUpdate(
    { _id: logId, status: { $in: [COMMUNICATION_STATUS.QUEUED, COMMUNICATION_STATUS.RETRYING] } },
    { $set: { status: COMMUNICATION_STATUS.SENDING, lastAttemptAt: new Date() }, $inc: { attemptCount: 1 } },
    { new: true }
  ).select('+attachmentStorageKey');
  if (!claimed) {
    return { claimed: false };
  }

  try {
    const result = await sendViaProvider(claimed);
    claimed.status = result.status === 'DELIVERED' ? COMMUNICATION_STATUS.DELIVERED : COMMUNICATION_STATUS.SENT;
    claimed.providerMessageId = result.providerMessageId || null;
    claimed.sentAt = new Date();
    claimed.failureReason = null;
    claimed.failedAt = null;
    claimed.nextAttemptAt = null;
    await claimed.save();
    // Audit coverage (Phase 10 Part O) - terminal success only, never one
    // entry per retry attempt (that would be noisy, not useful).
    await logAudit({
      actor: null,
      actorRole: 'SYSTEM',
      action: AUDIT_ACTIONS.COMMUNICATION_DISPATCHED,
      resourceType: 'Order',
      resourceId: claimed.order,
      metadata: { channel: claimed.channel, eventType: claimed.eventType, provider: claimed.provider },
    });
    return { claimed: true, outcome: 'SENT' };
  } catch (err) {
    const normalized = normalizeProviderError(err);
    claimed.failureReason = normalized.message;

    if (normalized.retryable && claimed.attemptCount < env.MAX_COMMUNICATION_RETRIES) {
      claimed.status = COMMUNICATION_STATUS.RETRYING;
      claimed.nextAttemptAt = new Date(Date.now() + computeNextAttemptDelayMs(claimed.attemptCount));
    } else {
      claimed.status = COMMUNICATION_STATUS.FAILED;
      claimed.failedAt = new Date();
    }
    await claimed.save();
    logger.warn(`[communicationProcessor] Delivery failed for ${claimed.eventType}/${claimed.channel} (${claimed._id}): ${normalized.message}`);
    if (claimed.status === COMMUNICATION_STATUS.FAILED) {
      // Terminal failure only - a RETRYING attempt isn't the end of the
      // story yet, so it doesn't need its own audit entry.
      await logAudit({
        actor: null,
        actorRole: 'SYSTEM',
        action: AUDIT_ACTIONS.COMMUNICATION_FAILED,
        resourceType: 'Order',
        resourceId: claimed.order,
        metadata: { channel: claimed.channel, eventType: claimed.eventType, provider: claimed.provider, reason: normalized.message, category: normalized.category },
      });
      notificationEventsService
        .notifyEmailFailed(claimed)
        .catch((notifyErr) => logger.error(`[communicationProcessor] notifyEmailFailed failed: ${notifyErr.message}`));
    }
    return { claimed: true, outcome: claimed.status, error: normalized };
  }
}

/** Processes every record currently due (QUEUED, or RETRYING whose nextAttemptAt has passed). */
async function processQueuedCommunications({ limit = 50 } = {}) {
  const due = await CommunicationLog.find({
    $or: [
      { status: COMMUNICATION_STATUS.QUEUED },
      { status: COMMUNICATION_STATUS.RETRYING, nextAttemptAt: { $lte: new Date() } },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select('_id');

  const results = { processed: 0, sent: 0, retrying: 0, failed: 0 };
  for (const doc of due) {
    try {
      const outcome = await attemptDelivery(doc._id);
      if (!outcome.claimed) continue;
      results.processed += 1;
      if (outcome.outcome === 'SENT') results.sent += 1;
      else if (outcome.outcome === COMMUNICATION_STATUS.RETRYING) results.retrying += 1;
      else if (outcome.outcome === COMMUNICATION_STATUS.FAILED) results.failed += 1;
    } catch (err) {
      // A single record's unexpected failure must never abort the batch.
      logger.error(`[communicationProcessor] Unexpected error processing ${doc._id}: ${err.message}`);
    }
  }
  return results;
}

module.exports = { attemptDelivery, processQueuedCommunications };
