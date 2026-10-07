const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const StorageProviderInterface = require('./StorageProvider.interface');
const env = require('../../config/portal');

/**
 * Stores files on local disk under a private, non-web-served directory.
 * Never place this directory inside frontend/public or any static-serve
 * root - files must only be reachable through authorized API endpoints
 * (see routes/documents.routes.js), never by direct URL.
 */
class LocalStorageAdapter extends StorageProviderInterface {
  constructor() {
    super();
    // Anchored to this file's location (backend/src/adapters/storage), never
    // to process.cwd() - callers of this adapter run with different working
    // directories (the server runs from backend/, but scripts/seed.js runs
    // from the repo root), and a cwd-relative path silently wrote files to
    // the wrong directory for any caller that wasn't backend/ itself.
    this.basePath = path.resolve(__dirname, '../../..', env.LOCAL_STORAGE_PATH);
  }

  async _ensureDir() {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  async save({ buffer, originalFileName, keyPrefix = '' }) {
    await this._ensureDir();
    const ext = path.extname(originalFileName || '').slice(0, 10);
    // keyPrefix (e.g. an orderId) is server-generated/validated by the
    // caller, never taken from a filename - see kyc.service.js. Storage
    // keys are never derived from client-controlled filenames at all.
    const safePrefix = keyPrefix ? `${String(keyPrefix).replace(/[^a-zA-Z0-9_-]/g, '')}/` : '';
    const storageKey = `${safePrefix}${crypto.randomUUID()}${ext}`;
    const fullPath = this._safeResolve(storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer, { mode: 0o600 });
    return { storageKey };
  }

  async read(storageKey) {
    const fullPath = this._safeResolve(storageKey);
    return fs.readFile(fullPath);
  }

  async delete(storageKey) {
    const fullPath = this._safeResolve(storageKey);
    try {
      await fs.unlink(fullPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async exists(storageKey) {
    const fullPath = this._safeResolve(storageKey);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prevents path traversal: resolves the key strictly inside basePath.
   * Compares against `basePath + path.sep` (not a bare string prefix), so
   * a sibling directory that merely starts with the same characters (e.g.
   * basePath "/data/kyc" vs "/data/kyc-evil") can never pass this check.
   */
  _safeResolve(storageKey) {
    if (typeof storageKey !== 'string' || storageKey.length === 0) {
      throw new Error('Invalid storage key.');
    }
    const fullPath = path.resolve(this.basePath, storageKey);
    const normalizedBase = this.basePath.endsWith(path.sep) ? this.basePath : this.basePath + path.sep;
    if (fullPath !== this.basePath && !fullPath.startsWith(normalizedBase)) {
      throw new Error('Invalid storage key.');
    }
    return fullPath;
  }
}

module.exports = LocalStorageAdapter;
