/**
 * Optional brand logo for the trademark checkout — PDF only, max 5 MB.
 * Kept in memory here and saved to the private uploads folder by the controller
 * only after all checks pass (so rejected requests never leave files behind).
 * Plain JSON requests (no logo) pass straight through.
 */
const multer = require('multer')
const { AppError } = require('./errorHandler')

const MAX_MB = 5

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' && /\.pdf$/i.test(file.originalname || '')
    cb(isPdf ? null : new AppError('Logo must be a PDF file', 400), isPdf)
  },
}).single('logo')

function trademarkLogo(req, res, next) {
  upload(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(`Logo PDF must be under ${MAX_MB} MB`, 400))
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(new AppError('Only one logo file can be uploaded', 400))
      return next(err.statusCode ? err : new AppError('Could not read the logo file', 400))
    }
    // Form fields arrive as text — turn them back into the types the validators expect.
    if (req.is('multipart/form-data')) {
      const b = req.body
      if (typeof b.classNumbers === 'string') {
        try { b.classNumbers = JSON.parse(b.classNumbers) } catch { b.classNumbers = 'invalid' }
      }
      for (const k of ['whatsappOptIn', 'expertToChoose']) {
        if (b[k] === 'true') b[k] = true
        else if (b[k] === 'false' || b[k] === '') b[k] = false
      }
    }
    next()
  })
}

/** True if the bytes really are a PDF (not just a renamed file). */
const looksLikePdf = buf => !!buf && buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-'

module.exports = { trademarkLogo, looksLikePdf, MAX_MB }