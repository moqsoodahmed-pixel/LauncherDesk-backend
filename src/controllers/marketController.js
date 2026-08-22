const Product = require('../models/Product')
const multer  = require('multer')
const path    = require('path')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

// Multer storage for product images
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads/products')),
  filename:    (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '-')}`),
})
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    /image\/(jpeg|png|webp)/.test(file.mimetype) ? cb(null, true) : cb(new Error('Only JPEG/PNG/WebP allowed'))
  },
})
exports.uploadImages = upload.array('images', 6)

// GET /api/market/products?category=Chairs&condition=refurbished&page=1&limit=12
exports.getAllProducts = asyncHandler(async (req, res) => {
  const { category, condition, featured, search, page = 1, limit = 12 } = req.query
  const filter = { isActive: true }
  if (category)            filter.category = { $regex: category, $options: 'i' }
  if (condition)           filter.condition = condition
  if (featured === 'true') filter.isFeatured = true
  if (search)              filter.$text = { $search: search }

  const skip = (Number(page) - 1) * Number(limit)

  const [products, total] = await Promise.all([
    Product.find(filter)
      .select('slug name price originalPrice category condition images isFeatured rating reviewCount stock')
      .sort({ isFeatured: -1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Product.countDocuments(filter),
  ])

  res.json({ success: true, total, page: Number(page), data: products })
})

// GET /api/market/products/:slug
exports.getProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true })
  if (!product) return next(new AppError('Product not found', 404))
  res.json({ success: true, data: product })
})

// GET /api/market/categories
exports.getCategories = asyncHandler(async (req, res) => {
  const categories = await Product.distinct('category', { isActive: true })
  res.json({ success: true, data: categories })
})

// POST /api/market/products  (admin)
exports.createProduct = asyncHandler(async (req, res) => {
  if (req.files?.length) req.body.images = req.files.map(f => `/uploads/products/${f.filename}`)
  const product = await Product.create(req.body)
  res.status(201).json({ success: true, data: product })
})

// PUT /api/market/products/:slug  (admin)
exports.updateProduct = asyncHandler(async (req, res, next) => {
  if (req.files?.length) req.body.images = req.files.map(f => `/uploads/products/${f.filename}`)
  const product = await Product.findOneAndUpdate({ slug: req.params.slug }, req.body, { new: true, runValidators: true })
  if (!product) return next(new AppError('Product not found', 404))
  res.json({ success: true, data: product })
})

// DELETE /api/market/products/:slug  (admin — soft delete)
exports.deleteProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findOneAndUpdate({ slug: req.params.slug }, { isActive: false }, { new: true })
  if (!product) return next(new AppError('Product not found', 404))
  res.json({ success: true, message: 'Product deactivated' })
})
