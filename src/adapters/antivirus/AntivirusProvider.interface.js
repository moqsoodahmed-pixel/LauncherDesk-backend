/**
 * Interface every antivirus/malware-scanning adapter must implement.
 * Mirrors the shape of adapters/storage/StorageProvider.interface.js so the
 * same plug-and-play pattern applies: callers only ever see a plain
 * `{ clean, threat }` result, never a provider-specific response shape, so
 * swapping in a real scanner later requires no changes outside this
 * adapter layer.
 *
 *   scan(buffer) -> Promise<{ clean: boolean, threat: string|null }>
 */
class AntivirusProviderInterface {
  async scan(_buffer) {
    throw new Error('scan() not implemented');
  }
}

module.exports = AntivirusProviderInterface;
