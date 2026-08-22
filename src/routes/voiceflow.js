const router = require('express').Router()
const {
  interact,
  deleteSession,
  getSessions,
  getSession,
} = require('../controllers/voiceflowController')
const { protect, restrictTo } = require('../middleware/auth')

// Public — called by the React chatbot widget
router.post('/interact',             interact)
router.delete('/session/:userId',    deleteSession)

// Admin — session analytics / lead review
router.get('/sessions',              protect, restrictTo('admin'), getSessions)
router.get('/sessions/:userId',      protect, restrictTo('admin'), getSession)

module.exports = router