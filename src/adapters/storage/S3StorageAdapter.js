const crypto = require('crypto');
const path = require('path');
const StorageProviderInterface = require('./StorageProvider.interface');
const env = require('../../config/portal');
const logger = require('../../utils/portal/logger');

class S3StorageAdapter extends StorageProviderInterface {
  constructor() {
    super();
    if (!env.STORAGE_BUCKET || !env.STORAGE_ACCESS_KEY || !env.STORAGE_SECRET_KEY) {
      throw new Error('S3StorageAdapter: STORAGE_BUCKET, STORAGE_ACCESS_KEY, and STORAGE_SECRET_KEY are required.');
    }
    this._client = null;
  }

  _getClient() {
    if (this._client) return this._client;
    const { S3Client } = require('@aws-sdk/client-s3');
    const config = {
      region: env.STORAGE_REGION || 'ap-south-1',
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
      },
    };
    if (env.STORAGE_ENDPOINT) {
      config.endpoint = env.STORAGE_ENDPOINT;
      config.forcePathStyle = true;
    }
    this._client = new S3Client(config);
    return this._client;
  }

  async save({ buffer, originalFileName, mimeType }) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const ext = path.extname(originalFileName || '').slice(0, 10);
    const storageKey = `kyc/${crypto.randomUUID()}${ext}`;
    await this._getClient().send(new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: mimeType || 'application/octet-stream',
      ServerSideEncryption: 'AES256',
      ACL: 'private',
    }));
    logger.info(`[S3] Saved: ${storageKey}`);
    return { storageKey };
  }

  async read(storageKey) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    this._assertKey(storageKey);
    const res = await this._getClient().send(new GetObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: storageKey,
    }));
    return this._streamToBuffer(res.Body);
  }

  async delete(storageKey) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    this._assertKey(storageKey);
    await this._getClient().send(new DeleteObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: storageKey,
    }));
    logger.info(`[S3] Deleted: ${storageKey}`);
  }

  _assertKey(storageKey) {
    if (!storageKey || typeof storageKey !== 'string')
      throw new Error('S3StorageAdapter: storageKey must be a non-empty string.');
    if (storageKey.includes('..') || storageKey.startsWith('/'))
      throw new Error('S3StorageAdapter: invalid storageKey.');
  }

  _streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}

module.exports = S3StorageAdapter;