const WhatsAppProviderInterface = require('./WhatsAppProvider.interface');
const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');

const WHATSAPP_SEND_URL = 'https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/';
const SMS_FLOW_URL = 'https://control.msg91.com/api/v5/flow/';

function buildRequestError(response, body) {
  const err = new Error(body?.message || body?.type || `MSG91 responded with status ${response.status}`);
  err.status = response.status;
  return err;
}

/**
 * Real MSG91 integration for both WhatsApp and SMS - same vendor, so one
 * adapter class covers both rather than duplicating provider-selection
 * logic across two directories. Never logs env.MSG91_AUTH_KEY.
 *
 * NOTE (honest limitation - see Phase 9 report): the exact WhatsApp
 * template request shape below follows MSG91's commonly documented v5
 * "whatsapp-outbound-message" structure (integrated_number + a template
 * payload with named component values), but MSG91 template component
 * naming can vary by how a template was registered on a given account.
 * This has NOT been exercised against a live MSG91 account (no
 * credentials available in this environment) - confirm the exact
 * `components` shape against the live MSG91 dashboard for the template(s)
 * actually in use before relying on this in production.
 */
class MSG91Provider extends WhatsAppProviderInterface {
  /** WhatsApp send, by pre-approved template name + ordered variables. */
  async send({ to, templateKey, variables = {} }) {
    const templateName = env.MSG91_DEFAULT_TEMPLATE_ID;
    if (!templateName) {
      const err = new Error('MSG91_DEFAULT_TEMPLATE_ID is not configured.');
      err.status = 400;
      throw err;
    }

    const componentValues = Object.values(variables).map((v) => ({ type: 'text', value: String(v ?? '') }));

    let response;
    try {
      response = await fetch(WHATSAPP_SEND_URL, {
        method: 'POST',
        headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          integrated_number: env.MSG91_WHATSAPP_INTEGRATED_NUMBER,
          content_type: 'template',
          payload: {
            messaging_product: 'whatsapp',
            type: 'template',
            template: {
              name: templateName,
              language: { code: 'en', policy: 'deterministic' },
              to_and_components: [{ to: [to], components: { body_1: componentValues } }],
            },
          },
        }),
      });
    } catch (err) {
      logger.error(`[MSG91Provider] Network error sending WhatsApp message (template=${templateKey}): ${err.message}`);
      throw new Error(`MSG91 request failed: ${err.message}`);
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      logger.warn(`[MSG91Provider] WhatsApp send failed (${response.status}): ${body?.message || 'no message'}`);
      throw buildRequestError(response, body);
    }

    return { status: 'SENT', providerMessageId: body?.request_id || body?.data?.[0]?.message_id || null };
  }

  /** SMS send via an MSG91 Flow (pre-approved template_id + ordered VARn variables). */
  async sendSms({ to, templateKey, variables = {} }) {
    const templateId = env.MSG91_SMS_TEMPLATE_ID;
    if (!templateId) {
      const err = new Error('MSG91_SMS_TEMPLATE_ID is not configured.');
      err.status = 400;
      throw err;
    }

    const varPayload = {};
    Object.values(variables).forEach((value, index) => {
      varPayload[`VAR${index + 1}`] = String(value ?? '');
    });

    let response;
    try {
      response = await fetch(SMS_FLOW_URL, {
        method: 'POST',
        headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          template_id: templateId,
          sender: env.MSG91_SENDER_ID,
          short_url: '0',
          mobiles: to,
          ...varPayload,
        }),
      });
    } catch (err) {
      logger.error(`[MSG91Provider] Network error sending SMS (template=${templateKey}): ${err.message}`);
      throw new Error(`MSG91 request failed: ${err.message}`);
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.type === 'error') {
      logger.warn(`[MSG91Provider] SMS send failed (${response.status}): ${body?.message || 'no message'}`);
      throw buildRequestError(response, body);
    }

    return { status: 'SENT', providerMessageId: body?.request_id || null };
  }
}

module.exports = MSG91Provider;
