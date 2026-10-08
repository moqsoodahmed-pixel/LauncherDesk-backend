const crypto = require('crypto');
const env = require('../../config/portal');
const { getStorageProvider } = require('../../adapters/storage');

/**
 * The ONLY place the rest of the application touches file storage. Backed
 * by the adapter selected in adapters/storage/index.js (local disk in dev,
 * S3-compatible in production - STORAGE_PROVIDER env var). Callers only
 * ever see an opaque storageKey, never a filesystem path or public URL, so
 * switching providers later needs no change here or at any call site.
 */

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Stores a file privately and returns its storage reference + checksum.
 * `keyPrefix` (e.g. an orderId) is server-generated/validated by the
 * caller - never derived from client-controlled input like a filename.
 * `mimeType` is optional (existing callers predating Part 5 don't pass it,
 * and LocalStorageAdapter/S3StorageAdapter ignore it for `save()`'s own
 * purposes anyway) - CloudinaryStorageAdapter is the first adapter that
 * actually uses it, to pick 'image' vs 'raw' resource_type.
 */
async function uploadPrivateDocument({ buffer, originalFileName, keyPrefix, mimeType }) {
  const provider = getStorageProvider();
  const { storageKey } = await provider.save({ buffer, originalFileName, mimeType, keyPrefix });
  let storageProvider = 'local';
  if (env.STORAGE_PROVIDER === 's3') storageProvider = 's3';
  else if (env.STORAGE_PROVIDER === 'cloudinary') storageProvider = 'cloudinary'; // Part 5 addition
  return {
    storageKey,
    storageProvider,
    checksum: sha256(buffer),
    sizeBytes: buffer.length,
  };
}

async function getPrivateDocument(storageKey) {
  const provider = getStorageProvider();
  return provider.read(storageKey);
}

async function deletePrivateDocument(storageKey) {
  const provider = getStorageProvider();
  await provider.delete(storageKey);
}

async function existsPrivateDocument(storageKey) {
  const provider = getStorageProvider();
  return provider.exists(storageKey);
}

module.exports = { uploadPrivateDocument, getPrivateDocument, deletePrivateDocument, existsPrivateDocument, sha256 };
