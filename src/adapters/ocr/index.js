const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');
const DisabledOcrProvider = require('./DisabledOcrProvider');

let _instance = null;

/**
 * Mirrors adapters/storage/index.js's getStorageProvider() pattern exactly.
 * Picks a provider via env.OCR_PROVIDER, defaulting to disabled. No real
 * provider is implemented yet (architecture only, per the brief) - add a
 * new adapter class + a branch here when one is, and update
 * KycOcrData.model.js's `source` values accordingly.
 */
function getOcrProvider() {
  if (_instance) return _instance;
  if (env.OCR_PROVIDER && env.OCR_PROVIDER !== 'disabled') {
    logger.warn(`[ocr] OCR_PROVIDER=${env.OCR_PROVIDER} has no adapter implemented yet - falling back to disabled.`);
  }
  _instance = new DisabledOcrProvider();
  return _instance;
}

module.exports = { getOcrProvider };
