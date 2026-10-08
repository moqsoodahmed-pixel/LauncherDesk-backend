const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');
const LocalStorageAdapter = require('./LocalStorageAdapter');
const S3StorageAdapter = require('./S3StorageAdapter');
const CloudinaryStorageAdapter = require('./CloudinaryStorageAdapter');

let _instance = null;

function getStorageProvider() {
  if (_instance) return _instance;
  if (env.STORAGE_PROVIDER === 's3') {
    logger.info('[storage] Using S3StorageAdapter');
    _instance = new S3StorageAdapter();
    return _instance;
  }
  // Part 5 addition - plug-and-play: inert until STORAGE_PROVIDER=cloudinary
  // is explicitly set AND the CLOUDINARY_* env vars are populated with real
  // keys. Nothing about the default 'local' path below changes.
  if (env.STORAGE_PROVIDER === 'cloudinary') {
    logger.info('[storage] Using CloudinaryStorageAdapter');
    _instance = new CloudinaryStorageAdapter();
    return _instance;
  }
  if (env.isProduction) {
    logger.warn('[storage] STORAGE_PROVIDER=local in production — ensure persistent volume.');
  }
  _instance = new LocalStorageAdapter();
  return _instance;
}

module.exports = { getStorageProvider };