const { body, param } = require('express-validator');
const { ALL_DOCUMENT_TYPES } = require('../../constants/portal/documentTypes');

const orderIdParam = param('id').isMongoId().withMessage('Invalid order id.');
const documentIdParam = param('documentId').isMongoId().withMessage('Invalid document id.');

const uploadDocumentValidator = [
  orderIdParam,
  body('documentType').isIn(ALL_DOCUMENT_TYPES).withMessage(`documentType must be one of: ${ALL_DOCUMENT_TYPES.join(', ')}.`),
];

const documentActionValidator = [orderIdParam, documentIdParam];

const rejectDocumentValidator = [
  orderIdParam,
  documentIdParam,
  body('reason').isString().trim().isLength({ min: 1, max: 500 }).withMessage('A rejection reason is required.'),
];

const orderIdOnlyValidator = [orderIdParam];

module.exports = {
  uploadDocumentValidator,
  documentActionValidator,
  rejectDocumentValidator,
  orderIdOnlyValidator,
};
