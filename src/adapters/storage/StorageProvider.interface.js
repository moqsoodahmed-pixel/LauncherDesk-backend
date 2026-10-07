/**
 * Interface every file storage adapter must implement. Callers only
 * ever deal with opaque storageKeys - never raw file paths or public
 * URLs - so swapping local <-> S3 requires no changes outside this
 * adapter layer.
 *
 *   save({ buffer, originalFileName, mimeType }) -> { storageKey }
 *   read(storageKey) -> Buffer
 *   delete(storageKey) -> void
 *   exists(storageKey) -> boolean
 */
class StorageProviderInterface {
  async save(_params) {
    throw new Error('save() not implemented');
  }

  async read(_storageKey) {
    throw new Error('read() not implemented');
  }

  async delete(_storageKey) {
    throw new Error('delete() not implemented');
  }

  async exists(_storageKey) {
    throw new Error('exists() not implemented');
  }
}

module.exports = StorageProviderInterface;
