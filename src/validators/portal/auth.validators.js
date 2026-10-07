const { body } = require('express-validator');
const { MAX_PASSWORD_LENGTH, PASSWORD_POLICY_MESSAGE, isPasswordStrongEnough } = require('../../services/portal/password.service');

// Email is trimmed + lower-cased only. normalizeEmail() is intentionally NOT
// used: it rewrites addresses (e.g. strips dots in Gmail), which would stop
// stored emails from matching.
const emailField = body('email')
  .isString()
  .withMessage('A valid email is required.')
  .bail()
  .trim()
  .isEmail()
  .withMessage('A valid email is required.')
  .isLength({ max: 254 })
  .toLowerCase();

const loginValidator = [
  emailField,
  body('password')
    .isString()
    .withMessage('Password is required.')
    .bail()
    .isLength({ min: 1, max: MAX_PASSWORD_LENGTH })
    .withMessage('Password is required.'),
];

const newPasswordField = (name) =>
  body(name)
    .isString()
    .withMessage(PASSWORD_POLICY_MESSAGE)
    .bail()
    .custom((value) => isPasswordStrongEnough(value))
    .withMessage(PASSWORD_POLICY_MESSAGE);

const changePasswordValidator = [
  body('currentPassword').isString().isLength({ min: 1, max: MAX_PASSWORD_LENGTH }).withMessage('Current password is required.'),
  newPasswordField('newPassword'),
];

const forgotPasswordValidator = [emailField];

const resetPasswordValidator = [
  body('token').isString().isLength({ min: 20, max: 200 }).withMessage('A valid reset token is required.'),
  newPasswordField('newPassword'),
];

// Only name/phone may be self-edited. Anything else (role, permissions,
// status, clientId, dataScope, ...) is rejected outright, never ignored
// silently, so a tampering attempt is visible.
const ALLOWED_PROFILE_FIELDS = ['name', 'phone'];

const updateProfileValidator = [
  body().custom((value) => {
    const unknown = Object.keys(value || {}).filter((key) => !ALLOWED_PROFILE_FIELDS.includes(key));
    if (unknown.length > 0) {
      throw new Error(`These fields cannot be changed: ${unknown.join(', ')}.`);
    }
    return true;
  }),
  body('name').optional().isString().trim().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters.'),
  body('phone')
    .optional({ nullable: true })
    .isString()
    .trim()
    .matches(/^[0-9+\-\s()]{6,20}$/)
    .withMessage('Phone number is invalid.'),
];

module.exports = {
  loginValidator,
  changePasswordValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  updateProfileValidator,
};
