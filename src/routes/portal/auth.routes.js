const express = require('express');
const router = express.Router();

const authController = require('../../controllers/portal/auth.controller');
const authenticate = require('../../middleware/portal/authenticate');
const validateRequest = require('../../middleware/portal/validateRequest');
const {
  loginValidator,
  changePasswordValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  updateProfileValidator,
} = require('../../validators/portal/auth.validators');
const { loginLimiter, passwordResetLimiter } = require('../../middleware/portal/rateLimiters');

// Public
router.post('/login', loginLimiter, loginValidator, validateRequest, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post('/forgot-password', passwordResetLimiter, forgotPasswordValidator, validateRequest, authController.forgotPassword);
router.post('/reset-password', passwordResetLimiter, resetPasswordValidator, validateRequest, authController.resetPassword);

// Authenticated
router.get('/me', authenticate, authController.me);
router.patch('/profile', authenticate, updateProfileValidator, validateRequest, authController.updateProfile);
router.post('/change-password', authenticate, changePasswordValidator, validateRequest, authController.changePassword);
router.post('/logout-all', authenticate, authController.logoutAll);

module.exports = router;
