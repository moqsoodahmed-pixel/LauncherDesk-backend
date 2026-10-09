const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');
const DisabledAntivirusProvider = require('./DisabledAntivirusProvider');
const ClamAvProvider = require('./ClamAvProvider');

let _instance = null;

/**
 * Mirrors adapters/storage/index.js's getStorageProvider() pattern exactly.
 * Picks a provider via env.ANTIVIRUS_PROVIDER, defaulting to the disabled
 * no-op - nothing changes for anyone who hasn't explicitly set
 * ANTIVIRUS_PROVIDER=clamav.
 */
function getAntivirusProvider() {
  if (_instance) return _instance;
  if (env.ANTIVIRUS_PROVIDER === 'clamav') {
    logger.info(`[antivirus] Using ClamAvProvider (${env.CLAMAV_HOST}:${env.CLAMAV_PORT}, timeout ${env.CLAMAV_TIMEOUT_MS}ms)`);
    _instance = new ClamAvProvider();
    return _instance;
  }
  if (env.ANTIVIRUS_PROVIDER && env.ANTIVIRUS_PROVIDER !== 'disabled') {
    logger.warn(`[antivirus] ANTIVIRUS_PROVIDER=${env.ANTIVIRUS_PROVIDER} has no adapter implemented - falling back to disabled.`);
  }
  _instance = new DisabledAntivirusProvider();
  return _instance;
}

/** Test-only escape hatch so a changed ANTIVIRUS_PROVIDER can take effect without a process restart. */
function _resetForTests() {
  _instance = null;
}

module.exports = { getAntivirusProvider, _resetForTests };
