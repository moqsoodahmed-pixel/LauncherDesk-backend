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

// Same provider classes handle both channels (MSG91Provider/
// DevelopmentWhatsAppProvider both implement sendSms() already) - this is
// a second accessor for the identical instance-selection logic, not a
// second provider hierarchy. Previously missing entirely, which crashed
// every SMS-channel dispatch (e.g. the ORDER_PAYMENT_CONFIRMED SMS) with
// "getSmsProvider is not a function" - confirmed via real failed
// CommunicationLog/notification records from live payment-confirmation
// activity during QA.
module.exports = { getWhatsAppProvider, getSmsProvider: getWhatsAppProvider };