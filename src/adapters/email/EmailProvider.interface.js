/**
 * Interface every email provider adapter must implement.
 *   send({ to, subject, html, templateKey, relatedResourceType, relatedResourceId }) -> { status }
 */
class EmailProviderInterface {
  async send(_params) {
    throw new Error('send() not implemented');
  }
}

module.exports = EmailProviderInterface;
