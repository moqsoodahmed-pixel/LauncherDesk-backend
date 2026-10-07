const crypto = require('crypto');
const WhatsAppProviderInterface = require('./WhatsAppProvider.interface');
const logger = require('../../utils/portal/logger');

class DevelopmentWhatsAppProvider extends WhatsAppProviderInterface {
  async send({ to, templateKey, variables = {} }) {
    logger.info(`[DevelopmentWhatsAppProvider] Would send WhatsApp message to ${to} | template=${templateKey} | vars=${JSON.stringify(variables)}`);
    return { status: 'SENT', providerMessageId: `dev_wa_${crypto.randomUUID()}` };
  }

  async sendSms({ to, templateKey, variables = {} }) {
    logger.info(`[DevelopmentWhatsAppProvider] Would send SMS to ${to} | template=${templateKey} | vars=${JSON.stringify(variables)}`);
    return { status: 'SENT', providerMessageId: `dev_sms_${crypto.randomUUID()}` };
  }
}

module.exports = DevelopmentWhatsAppProvider;
