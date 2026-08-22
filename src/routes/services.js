const router = require('express').Router()
const { getAllServices, getService, createService, updateService, deleteService } = require('../controllers/serviceController')
const { protect, restrictTo } = require('../middleware/auth')

router.get('/',         getAllServices)
router.get('/:slug',    getService)
router.post('/',        protect, restrictTo('admin'), createService)
router.put('/:slug',    protect, restrictTo('admin'), updateService)
router.delete('/:slug', protect, restrictTo('admin'), deleteService)

module.exports = router
