const router = require('express').Router()
const { submitContact, getAllContacts, updateContact } = require('../controllers/contactController')
const { protect, restrictTo } = require('../middleware/auth')
const { contactValidators, validate } = require('../middleware/validate')

router.post('/',     contactValidators, validate, submitContact)
router.get('/',      protect, restrictTo('admin'), getAllContacts)
router.patch('/:id', protect, restrictTo('admin'), updateContact)

module.exports = router