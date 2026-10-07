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
 */
async function uploadPrivateDocument({ buffer, originalFileName, keyPrefix }) {
  const provider = getStorageProvider();
  const { storageKey } = await provider.save({ buffer, originalFileName, keyPrefix });
  return {
    storageKey,
    storageProvider: env.STORAGE_PROVIDER === 's3' ? 's3' : 'local',
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
