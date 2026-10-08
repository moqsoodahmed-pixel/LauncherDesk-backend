const EmailProviderInterface = require('./EmailProvider.interface');
const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Real Brevo (Sendinblue) transactional email integration. This adapter
 * ONLY sends and returns/throws - it never touches the database itself;
 * communicationProcessor.service.js owns writing the CommunicationLog
 * record, so there is exactly one place that persists delivery state.
 * Never logs env.BREVO_API_KEY.
 */
class BrevoProvider extends EmailProviderInterface {
  /**
   * `attachments` (optional): [{ filename, content }] where content is a
   * Buffer or base64 string - passed straight through to Brevo's own
   * `attachment` field (its documented format: base64 `content` + `name`).
   * Nothing here persists the attachment; the caller (invoice.service.js)
   * is responsible for already having stored the file and is only handing
   * it here to be sent.
   */
  async send({ to, subject, html, attachments }) {
    let response;
    try {
      const body = {
        sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      };
      if (Array.isArray(attachments) && attachments.length > 0) {
        body.attachment = attachments.map((a) => ({
          content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
          name: a.filename,
        }));
      }
      response = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': env.BREVO_API_KEY,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network-level failure (DNS, timeout, connection reset) - never log
      // the request body (it was built from env.BREVO_API_KEY's sibling
      // config only, but keep the discipline of never widening what's logged).
      logger.error(`[BrevoProvider] Network error sending email: ${err.message}`);
      const normalized = new Error(`Brevo request failed: ${err.message}`);
      normalized.status = undefined; // let providerError.service.js classify this as TRANSIENT via message pattern
      throw normalized;
    }

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      logger.warn(`[BrevoProvider] Send failed (${response.status}): ${body?.message || 'no message'}`);
      const err = new Error(body?.message || `Brevo responded with status ${response.status}`);
      err.status = response.status;
      throw err;
    }

    return { status: 'SENT', providerMessageId: body?.messageId || null };
  }
}

module.exports = BrevoProvider;
