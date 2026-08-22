const router = require('express').Router()
const { submitQuote, getAllQuotes, updateQuote } = require('../controllers/quoteController')
const { protect, restrictTo } = require('../middleware/auth')

router.post('/', submitQuote)
router.get('/',    protect, restrictTo('admin'), getAllQuotes)
router.patch('/:id', protect, restrictTo('admin'), updateQuote)

module.exports = router
