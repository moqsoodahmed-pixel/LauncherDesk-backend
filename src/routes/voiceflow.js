const router = require('express').Router()
const {
  interact,
  deleteSession,
  getSessions,
  getSession,
  adminDeleteSession,
} = require('../controllers/voiceflowController')
const { protect, restrictTo } = require('../middleware/auth')

// Logged-in users only — Sneha (the chatbot widget) requires login.
// The session id is always taken from the verified token, never from the
// request body, so one user can't read or continue another user's chat.
const useTokenUserId = (req, res, next) => {
  req.body = { ...(req.body || {}), userId: String(req.user._id) }
  next()
}
const ownSessionOnly = (req, res, next) => {
  if (req.user.role !== 'admin' && req.params.userId !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: 'You can only delete your own chat session' })
  }
  next()
}
router.post('/interact',             protect, useTokenUserId, interact)
router.delete('/session/:userId',    protect, ownSessionOnly, deleteSession)

// Admin — session analytics / lead review
router.get('/sessions',              protect, restrictTo('admin'), getSessions)
router.get('/sessions/:userId',      protect, restrictTo('admin'), getSession)
router.delete('/sessions/:userId',   protect, restrictTo('admin'), adminDeleteSession)

module.exports = router