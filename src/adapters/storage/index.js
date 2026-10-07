const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');
const LocalStorageAdapter = require('./LocalStorageAdapter');
const S3StorageAdapter = require('./S3StorageAdapter');

let _instance = null;

function getStorageProvider() {
  if (_instance) return _instance;
  if (env.STORAGE_PROVIDER === 's3') {
    logger.info('[storage] Using S3StorageAdapter');
    _instance = new S3StorageAdapter();
    return _instance;
  }
  if (env.isProduction) {
    logger.warn('[storage] STORAGE_PROVIDER=local in production — ensure persistent volume.');
  }
  _instance = new LocalStorageAdapter();
  return _instance;
}

module.exports = { getStorageProvider };