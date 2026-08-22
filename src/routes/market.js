const router = require('express').Router()
const {
  getAllProducts, getProduct, getCategories,
  createProduct, updateProduct, deleteProduct, uploadImages,
} = require('../controllers/marketController')
const { protect, restrictTo } = require('../middleware/auth')

// Public
router.get('/products',          getAllProducts)
router.get('/products/:slug',    getProduct)
router.get('/categories',        getCategories)

// Admin
router.post('/products',         protect, restrictTo('admin'), uploadImages, createProduct)
router.put('/products/:slug',    protect, restrictTo('admin'), uploadImages, updateProduct)
router.delete('/products/:slug', protect, restrictTo('admin'), deleteProduct)

module.exports = router
