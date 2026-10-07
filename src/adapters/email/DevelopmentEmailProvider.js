const crypto = require('crypto');
const EmailProviderInterface = require('./EmailProvider.interface');
const logger = require('../../utils/portal/logger');

/**
 * Logs what WOULD be sent instead of actually sending, so the app is fully
 * runnable before Brevo credentials exist. Never claims a real delivery -
 * callers must be able to tell from `provider: 'DEVELOPMENT'` on the
 * CommunicationLog record (written by communicationProcessor.service.js,
 * not here) that this was simulated.
 */
class DevelopmentEmailProvider extends EmailProviderInterface {
  async send({ to, subject, html, templateKey }) {
    logger.info(`[DevelopmentEmailProvider] Would send email to ${to} | subject="${subject}" | template=${templateKey}`);
    return { status: 'SENT', providerMessageId: `dev_email_${crypto.randomUUID()}` };
  }
}

module.exports = DevelopmentEmailProvider;
