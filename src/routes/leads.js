const router = require('express').Router()
const { createLead, getAllLeads, updateLead } = require('../controllers/leadController')
const { protect, restrictTo } = require('../middleware/auth')
const { leadValidators, validate } = require('../middleware/validate')

router.post('/',     leadValidators, validate, createLead)
router.get('/',      protect, restrictTo('admin'), getAllLeads)
router.patch('/:id', protect, restrictTo('admin'), updateLead)

module.exports = router