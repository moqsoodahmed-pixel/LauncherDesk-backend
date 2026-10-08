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

// ── Wave 2 (admin/super-admin KYC workflows) additions - all additive ──────

const rejectCompleteKycValidator = [
  orderIdParam,
  body('reason').isString().trim().isLength({ min: 1, max: 500 }).withMessage('A rejection reason is required.'),
];

const MAX_BULK_DOCUMENTS = 50;
const bulkDocumentIdsValidator = [
  orderIdParam,
  body('documentIds')
    .isArray({ min: 1, max: MAX_BULK_DOCUMENTS })
    .withMessage(`documentIds must be an array of 1-${MAX_BULK_DOCUMENTS} document ids.`),
  body('documentIds.*').isMongoId().withMessage('Each documentId must be a valid id.'),
];

const bulkRejectValidator = [
  ...bulkDocumentIdsValidator,
  body('reason').isString().trim().isLength({ min: 1, max: 500 }).withMessage('A rejection reason is required.'),
];

const commentValidator = [
  orderIdParam,
  body('message').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('A comment message is required.'),
  body('documentId').optional({ nullable: true }).isMongoId().withMessage('Invalid document id.'),
  body('visibility').optional().isIn(['INTERNAL', 'CLIENT_VISIBLE']).withMessage('Invalid visibility.'),
];

const assignReviewerValidator = [
  param('documentId').isMongoId().withMessage('Invalid document id.'),
  body('reviewerId').isMongoId().withMessage('Invalid reviewer id.'),
];

const exportValidator = [orderIdParam];

const clientIdParam = param('clientId').isMongoId().withMessage('Invalid client id.');
const exportClientValidator = [clientIdParam];

module.exports = {
  uploadDocumentValidator,
  documentActionValidator,
  rejectDocumentValidator,
  orderIdOnlyValidator,
  MAX_BULK_DOCUMENTS,
  rejectCompleteKycValidator,
  bulkDocumentIdsValidator,
  bulkRejectValidator,
  commentValidator,
  assignReviewerValidator,
  exportValidator,
  exportClientValidator,
};
