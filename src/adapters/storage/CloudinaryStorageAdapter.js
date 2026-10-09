const crypto = require('crypto');
const StorageProviderInterface = require('./StorageProvider.interface');
const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');

/**
 * Cloudinary-backed storage adapter, implementing the exact same 4-method
 * contract as LocalStorageAdapter.js/S3StorageAdapter.js. Plug-and-play per
 * the brief's hard constraint: no Cloudinary credentials are hardcoded
 * anywhere - it reads CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/
 * CLOUDINARY_API_SECRET from env (see config/portal.js), and is only ever
 * instantiated by adapters/storage/index.js when STORAGE_PROVIDER=cloudinary
 * is explicitly set, so nothing changes for today's local/S3 setups.
 *
 * `require('cloudinary')` is done LAZILY inside _getClient(), never at
 * module load time, so this file can be required unconditionally by
 * adapters/storage/index.js (matching S3StorageAdapter's own lazy
 * `require('@aws-sdk/client-s3')` pattern) without forcing the dependency
 * onto the default local-storage path. The `cloudinary` npm package has
 * been installed (package.json) so this is also fully usable the moment
 * real credentials are added - no further code or install step is needed.
 *
 * storageKey ENCODING (judgment call, documented since read()/delete() must
 * parse it back out): a single JSON string of
 *   { "publicId": "<cloudinary public_id>", "resourceType": "image"|"raw"|"video" }
 * A delimited string (e.g. "raw:kyc/abc123") was the other option
 * considered; JSON was chosen because it's self-describing, trivially
 * extensible (e.g. adding a `format` field later needs no re-parsing
 * scheme change), and avoids ambiguity if a public_id itself ever contained
 * the delimiter character. storageKey stays fully opaque to every caller
 * above documentStorage.service.js either way.
 *
 * File-security pipeline hardening pass over this adapter:
 *  - folder is now 'kyc/clients/documents[/<orderId>]' (keyPrefix-aware,
 *    see save() below) instead of a flat 'launcherdesk/kyc'.
 *  - public_id is now an EXPLICIT crypto.randomUUID(), never left to
 *    Cloudinary's own unique_filename randomization - self-documenting and
 *    consistent with Local/S3StorageAdapter's own UUID storageKeys.
 *  - read()'s signed download URL TTL is now SIGNED_URL_EXPIRY (env,
 *    default 300s) instead of a hardcoded 60s.
 *  - type: 'authenticated' (never a public/guessable URL) was already
 *    correct and is unchanged.
 *  - Replace/delete semantics were audited against kyc.service.js's
 *    uploadDocument(): a re-upload does NOT delete the previous version's
 *    Cloudinary asset here, and that is intentional, not an oversight -
 *    the previous KycDocument row is kept with isCurrentVersion:false and
 *    its OWN storageKey still pointing at the OLD asset, specifically so
 *    version history stays downloadable/exportable (see
 *    listDocuments({includeAllVersions}) and exportOrderKycDocuments). The
 *    old asset is therefore never "orphaned" (it is still referenced by
 *    that old row) and is only ever actually deleted later, by
 *    kycDeletion.service.js's deleteDocumentFile() under the retention
 *    policy - which already deletes the storage object BEFORE flipping
 *    lifecycleStatus to DELETED, and leaves the document untouched
 *    (re-throwing) if the storage delete fails, so that path was already
 *    orphan-safe and needed no change.
 */
class CloudinaryStorageAdapter extends StorageProviderInterface {
  constructor() {
    super();
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      throw new Error('CloudinaryStorageAdapter: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are required.');
    }
    this._client = null;
  }

  _getClient() {
    if (this._client) return this._client;
    // Lazy require - see class doc-comment above.
    const { v2: cloudinary } = require('cloudinary');
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    this._client = cloudinary;
    return this._client;
  }

  /** Non-image documents (PDFs etc.) upload as 'raw'; images as 'image' - 'auto' detection is not reliable for private/raw PDFs on Cloudinary. */
  _resourceTypeFor(mimeType) {
    if (mimeType && mimeType.startsWith('image/')) return 'image';
    return 'raw';
  }

  _encodeKey(publicId, resourceType) {
    return JSON.stringify({ publicId, resourceType });
  }

  _decodeKey(storageKey) {
    if (typeof storageKey !== 'string' || !storageKey) {
      throw new Error('Invalid storage key.');
    }
    let parsed;
    try {
      parsed = JSON.parse(storageKey);
    } catch {
      throw new Error('Invalid storage key.');
    }
    if (!parsed || typeof parsed.publicId !== 'string' || typeof parsed.resourceType !== 'string') {
      throw new Error('Invalid storage key.');
    }
    return parsed;
  }

  /**
   * `keyPrefix` (e.g. an orderId, server-generated - see
   * documentStorage.service.js/kyc.service.js, never client-controlled)
   * places the asset under a per-order subfolder, mirroring
   * LocalStorageAdapter's own keyPrefix handling. Folder root is
   * 'kyc/clients/documents' - a clearer, intentional hierarchy than a flat
   * bucket, and easy to lock down with a single Cloudinary folder-level
   * access rule if desired.
   */
  async save({ buffer, originalFileName, mimeType, keyPrefix }) {
    const cloudinary = this._getClient();
    const resourceType = this._resourceTypeFor(mimeType);
    const safePrefix = keyPrefix ? `/${String(keyPrefix).replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
    const folder = `kyc/clients/documents${safePrefix}`;
    // Explicit UUID public_id - never derived from, or containing any part
    // of, the original filename (use_filename/unique_filename left at
    // Cloudinary's defaults would still avoid the filename, but an explicit
    // crypto.randomUUID() is self-documenting and matches the same
    // generation scheme LocalStorageAdapter/S3StorageAdapter already use).
    const publicId = crypto.randomUUID();

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: resourceType,
          // 'authenticated' keeps the asset off any guessable public URL -
          // private documents are only ever fetched back through this
          // adapter's read(), never a direct Cloudinary URL.
          type: 'authenticated',
        },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      uploadStream.end(buffer);
    });

    logger.info(`[Cloudinary] Saved: ${result.public_id} (${resourceType})`);
    return { storageKey: this._encodeKey(result.public_id, resourceType) };
  }

  async read(storageKey) {
    const cloudinary = this._getClient();
    const { publicId, resourceType } = this._decodeKey(storageKey);

    // Private/'authenticated' assets need a signed URL even for server-side
    // retrieval - generate one with a short, configurable TTL
    // (SIGNED_URL_EXPIRY, default 300s) and fetch the bytes through it.
    const url = cloudinary.utils.private_download_url(publicId, undefined, {
      resource_type: resourceType,
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + env.SIGNED_URL_EXPIRY,
    });

    const https = require('https');
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`CloudinaryStorageAdapter: read failed with status ${res.statusCode}`));
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        })
        .on('error', reject);
    });
  }

  async delete(storageKey) {
    const cloudinary = this._getClient();
    const { publicId, resourceType } = this._decodeKey(storageKey);
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: 'authenticated' });
    logger.info(`[Cloudinary] Deleted: ${publicId}`);
  }

  async exists(storageKey) {
    const cloudinary = this._getClient();
    const { publicId, resourceType } = this._decodeKey(storageKey);
    try {
      await cloudinary.api.resource(publicId, { resource_type: resourceType, type: 'authenticated' });
      return true;
    } catch (err) {
      if (err && (err.http_code === 404 || err.error?.http_code === 404)) return false;
      throw err;
    }
  }
}

module.exports = CloudinaryStorageAdapter;
