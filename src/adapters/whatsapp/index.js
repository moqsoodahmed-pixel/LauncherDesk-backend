const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');
const MSG91Provider = require('./MSG91Provider');
const DevelopmentWhatsAppProvider = require('./DevelopmentWhatsAppProvider');

function getWhatsAppProvider() {
  if (env.MSG91_AUTH_KEY) {
    logger.info('[whatsapp] Using MSG91Provider');
    return new MSG91Provider();
  }
  if (env.isProduction) {
    throw new Error('MSG91_AUTH_KEY required in production. Refusing DevelopmentWhatsAppProvider.');
  }
  logger.warn('[whatsapp] No MSG91_AUTH_KEY — using DevelopmentWhatsAppProvider (dev only)');
  return new DevelopmentWhatsAppProvider();
}

module.exports = { getWhatsAppProvider };