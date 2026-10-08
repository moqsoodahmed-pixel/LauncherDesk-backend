/**
 * Interface every OCR/data-extraction adapter must implement. Mirrors
 * adapters/storage/StorageProvider.interface.js's pattern. Extracted data
 * is stored SEPARATELY from the KycDocument itself, in its own
 * KycOcrData row (see models/portal/KycOcrData.model.js) - never merged
 * into KycDocument's metadata-only schema.
 *
 *   extractFields(buffer, documentType) ->
 *     Promise<{ fields: Object, confidence: number, rawProviderResponse: any }>
 *
 * `fields` is a flat, optional-string bag (panNumber, gstNumber, ifsc,
 * accountNumber, name, dob, address, companyName, registrationNumber, ...)
 * - see KycOcrData.model.js for the exact field list a provider should
 * attempt to populate. `confidence` is a 0..1 overall score.
 * `rawProviderResponse` is kept for audit/debugging and is never surfaced
 * to a client.
 */
class OcrProviderInterface {
  async extractFields(_buffer, _documentType) {
    throw new Error('extractFields() not implemented');
  }
}

module.exports = OcrProviderInterface;
