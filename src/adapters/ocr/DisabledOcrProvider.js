const OcrProviderInterface = require('./OcrProvider.interface');

/**
 * Default, architecture-only placeholder. No real OCR call is wired
 * anywhere yet (per the brief: "Currently keep provider disabled").
 *
 * Judgment call: resolves with an explicit `{ fields: {}, confidence: 0,
 * disabled: true }` rather than throwing. Nothing in this codebase calls
 * extractFields() yet, so either choice is currently inert, but a resolved
 * "disabled" result is the friendlier contract for whichever future caller
 * (e.g. an admin "extract fields" button) ends up invoking this - it can
 * check `result.disabled` and show "OCR not configured" in the UI instead
 * of having to wrap every call in a try/catch for an expected, non-error
 * condition.
 */
class DisabledOcrProvider extends OcrProviderInterface {
  async extractFields(_buffer, _documentType) {
    return { fields: {}, confidence: 0, disabled: true, rawProviderResponse: null };
  }
}

module.exports = DisabledOcrProvider;
