/**
 * Uploads for customer documents. Files are stored OUTSIDE the public
 * /uploads folder and are only served through authenticated routes.
 * NOTE: on hosts with an ephemeral disk (e.g. Railway without a volume),
 * mount a persistent volume at PRIVATE_UPLOAD_DIR or move this to S3.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const multer = require('multer')

const DIR = process.env.PRIVATE_UPLOAD_DIR || path.join(__dirname, '..', '..', 'private_uploads')
fs.mkdirSync(DIR, { recursive: true })

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document']

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase().slice(0, 8)}`),
  }),
  limits: { fileSize: Number(process.env.MAX_DOCUMENT_MB || 10) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(ALLOWED.includes(file.mimetype) ? null : new Error('Only PDF, JPG, PNG, WEBP or Word files are allowed'), ALLOWED.includes(file.mimetype)),
})

const resolveFile = stored => {
  const full = path.resolve(DIR, path.basename(stored || ''))
  return full.startsWith(path.resolve(DIR)) && fs.existsSync(full) ? full : null
}

module.exports = { upload, resolveFile, DIR }
