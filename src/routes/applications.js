const router = require('express').Router()
const { submitApplication, getAllApplications, updateApplication, uploadResume } = require('../controllers/applicationController')
const { protect, restrictTo } = require('../middleware/auth')

router.post('/',    uploadResume, submitApplication)
router.get('/',     protect, restrictTo('admin'), getAllApplications)
router.patch('/:id', protect, restrictTo('admin'), updateApplication)

module.exports = router
