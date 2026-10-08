const AntivirusProviderInterface = require('./AntivirusProvider.interface');

/**
 * Default, no-op placeholder. Always reports the file clean - this is NOT
 * real malware scanning, it only keeps the integration point real and
 * wired (see kyc.service.js's uploadDocument) so a genuine provider (e.g.
 * ClamAV, a cloud AV API) can be dropped in later via
 * adapters/antivirus/index.js without touching any call site.
 *
 * Judgment call: returns a resolved "clean" result rather than throwing,
 * so that leaving ANTIVIRUS_PROVIDER unset (the default) never changes
 * today's upload behavior - matching the brief's explicit "wire a
 * currently-always-passing scan call... without changing any current
 * upload behavior".
 */
class DisabledAntivirusProvider extends AntivirusProviderInterface {
  async scan(_buffer) {
    return { clean: true, threat: null };
  }
}

module.exports = DisabledAntivirusProvider;
