const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');
const DisabledAntivirusProvider = require('./DisabledAntivirusProvider');

let _instance = null;

/**
 * Mirrors adapters/storage/index.js's getStorageProvider() pattern exactly.
 * Picks a provider via env.ANTIVIRUS_PROVIDER, defaulting to the disabled
 * no-op. No real provider is implemented yet (architecture only, per the
 * brief) - add a new adapter class + a branch here when one is.
 */
function getAntivirusProvider() {
  if (_instance) return _instance;
  if (env.ANTIVIRUS_PROVIDER && env.ANTIVIRUS_PROVIDER !== 'disabled') {
    logger.warn(`[antivirus] ANTIVIRUS_PROVIDER=${env.ANTIVIRUS_PROVIDER} has no adapter implemented yet - falling back to disabled.`);
  }
  _instance = new DisabledAntivirusProvider();
  return _instance;
}

module.exports = { getAntivirusProvider };
