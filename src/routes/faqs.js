const router = require('express').Router()
const { getAllFAQs, createFAQ, updateFAQ, deleteFAQ } = require('../controllers/faqController')
const { protect, restrictTo } = require('../middleware/auth')

router.get('/', getAllFAQs)
router.post('/',    protect, restrictTo('admin'), createFAQ)
router.put('/:id',  protect, restrictTo('admin'), updateFAQ)
router.delete('/:id', protect, restrictTo('admin'), deleteFAQ)

module.exports = router
