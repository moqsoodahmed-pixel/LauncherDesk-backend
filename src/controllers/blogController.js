const Blog   = require('../models/Blog')
const multer = require('multer')
const path   = require('path')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

// Multer storage for cover images
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads/blog')),
  filename:    (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '-')}`),
})
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    /image\/(jpeg|png|webp|gif)/.test(file.mimetype) ? cb(null, true) : cb(new Error('Only images allowed'))
  },
})
exports.uploadCover = upload.single('cover')

// GET /api/blogs
exports.getAllBlogs = asyncHandler(async (req, res) => {
  const { category, page = 1, limit = 12 } = req.query
  const filter = { isPublished: true }
  if (category) filter.category = category
  const skip = (Number(page) - 1) * Number(limit)

  const [blogs, total] = await Promise.all([
    Blog.find(filter)
      .select('slug title excerpt coverImage category tags publishedAt views')
      .populate('author', 'name')
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Blog.countDocuments(filter),
  ])

  res.json({ success: true, total, page: Number(page), data: blogs })
})

// GET /api/blogs/:slug
exports.getBlog = asyncHandler(async (req, res, next) => {
  const blog = await Blog.findOneAndUpdate(
    { slug: req.params.slug, isPublished: true },
    { $inc: { views: 1 } },
    { new: true }
  ).populate('author', 'name')

  if (!blog) return next(new AppError('Blog post not found', 404))
  res.json({ success: true, data: blog })
})

// POST /api/blogs  (admin)
exports.createBlog = asyncHandler(async (req, res) => {
  if (req.file) req.body.coverImage = `/uploads/blog/${req.file.filename}`
  if (req.body.isPublished) req.body.publishedAt = new Date()
  const blog = await Blog.create({ ...req.body, author: req.user._id })
  res.status(201).json({ success: true, data: blog })
})

// PUT /api/blogs/:slug  (admin)
exports.updateBlog = asyncHandler(async (req, res, next) => {
  if (req.file) req.body.coverImage = `/uploads/blog/${req.file.filename}`
  if (req.body.isPublished && !req.body.publishedAt) req.body.publishedAt = new Date()
  const blog = await Blog.findOneAndUpdate({ slug: req.params.slug }, req.body, { new: true, runValidators: true })
  if (!blog) return next(new AppError('Blog post not found', 404))
  res.json({ success: true, data: blog })
})

// DELETE /api/blogs/:slug  (admin)
exports.deleteBlog = asyncHandler(async (req, res, next) => {
  const blog = await Blog.findOneAndDelete({ slug: req.params.slug })
  if (!blog) return next(new AppError('Blog post not found', 404))
  res.json({ success: true, message: 'Blog post deleted' })
})
