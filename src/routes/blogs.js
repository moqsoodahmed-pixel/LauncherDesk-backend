const router = require('express').Router()
const { getAllBlogs, getBlog, createBlog, updateBlog, deleteBlog, uploadCover } = require('../controllers/blogController')
const { protect, restrictTo } = require('../middleware/auth')

router.get('/',         getAllBlogs)
router.get('/:slug',    getBlog)
router.post('/',        protect, restrictTo('admin'), uploadCover, createBlog)
router.put('/:slug',    protect, restrictTo('admin'), uploadCover, updateBlog)
router.delete('/:slug', protect, restrictTo('admin'), deleteBlog)

module.exports = router
