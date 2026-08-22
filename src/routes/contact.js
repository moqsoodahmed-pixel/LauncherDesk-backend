const router = require('express').Router()
const { submitContact, getAllContacts, updateContact } = require('../controllers/contactController')
const { protect, restrictTo } = require('../middleware/auth')

// Public
router.post('/', submitContact)

// Admin only
router.get('/',    protect, restrictTo('admin'), getAllContacts)
router.patch('/:id', protect, restrictTo('admin'), updateContact)

module.exports = router
