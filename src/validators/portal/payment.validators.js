const { body, param } = require('express-validator');

const orderIdParam = param('id').isMongoId().withMessage('Invalid order id.');

const createPaymentOrderValidator = [orderIdParam];

const verifyPaymentValidator = [
  orderIdParam,
  body('razorpay_order_id').isString().trim().notEmpty().withMessage('razorpay_order_id is required.'),
  body('razorpay_payment_id').isString().trim().notEmpty().withMessage('razorpay_payment_id is required.'),
  body('razorpay_signature').isString().trim().notEmpty().withMessage('razorpay_signature is required.'),
];

const reportFailureValidator = [
  orderIdParam,
  body('razorpay_order_id').isString().trim().notEmpty().withMessage('razorpay_order_id is required.'),
  body('reason').optional().isString().trim().isLength({ max: 300 }),
];

const refundValidator = [orderIdParam, body('reason').optional().isString().trim().isLength({ max: 300 })];

module.exports = { createPaymentOrderValidator, verifyPaymentValidator, reportFailureValidator, refundValidator, orderIdParam };
