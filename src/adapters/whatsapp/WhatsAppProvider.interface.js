/**
 * Interface every WhatsApp/SMS provider adapter must implement (same
 * vendor typically handles both - see MSG91Provider.js).
 *   send({ to, templateKey, variables }) -> { status, providerMessageId } // WhatsApp
 *   sendSms({ to, templateKey, variables }) -> { status, providerMessageId } // SMS
 */
class WhatsAppProviderInterface {
  async send(_params) {
    throw new Error('send() not implemented');
  }

  async sendSms(_params) {
    throw new Error('sendSms() not implemented');
  }
}

module.exports = WhatsAppProviderInterface;
