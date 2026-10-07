const { body, param, query } = require('express-validator');
const { ALL_SERVICE_STATUSES } = require('../../constants/portal/serviceStatus');
const { ALL_SERVICE_CATEGORIES } = require('../../constants/portal/serviceCategory');
const { ALL_DOCUMENT_TYPES } = require('../../constants/portal/documentTypes');
const { validateFormSchema } = require('../../services/portal/formSchema.service');

const SORT_FIELDS = ['serviceCode', 'name', 'category', 'basePriceMinor', 'status', 'createdAt', 'updatedAt', 'sortOrder'];
const MAX_PAGE_SIZE = 100;

const idParam = param('id').isMongoId().withMessage('Invalid service id.');
const idOnlyValidator = [idParam];

// Short, human-friendly, normalized uppercase (e.g. WABOT, CRM, HRMS).
const SERVICE_CODE_PATTERN = /^[A-Z0-9_-]{2,20}$/;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const listServicesValidator = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: MAX_PAGE_SIZE }).toInt(),
  query('search').optional().isString().trim().isLength({ max: 200 }),
  query('status').optional().isIn(ALL_SERVICE_STATUSES),
  query('category').optional().isIn(ALL_SERVICE_CATEGORIES),
  query('isPublic').optional().isBoolean().toBoolean(),
  query('requiresKyc').optional().isBoolean().toBoolean(),
  query('minPrice').optional().isFloat({ min: 0 }).toFloat(),
  query('maxPrice').optional().isFloat({ min: 0 }).toFloat(),
  query('sortBy').optional().isIn(SORT_FIELDS).withMessage(`sortBy must be one of: ${SORT_FIELDS.join(', ')}.`),
  query('sortDir').optional().isIn(['asc', 'desc']),
];

const pricingFields = [
  body('basePrice').isFloat({ min: 0, max: 10000000 }).withMessage('basePrice must be a non-negative number (in rupees).'),
  body('currency').optional().isIn(['INR']).withMessage('Only INR is supported at this time.'),
  body('gstApplicable').optional().isBoolean().toBoolean(),
  body('gstPercentage').optional().isFloat({ min: 0, max: 100 }).withMessage('gstPercentage must be between 0 and 100.'),
];

const formSchemaField = body('formSchema')
  .optional()
  .custom((value) => {
    const errors = validateFormSchema(value);
    if (errors.length > 0) throw new Error(errors.join(' '));
    return true;
  });

const requiredDocumentsField = body('requiredDocuments')
  .optional()
  .isArray()
  .withMessage('requiredDocuments must be an array.')
  .bail()
  .custom((docs) => {
    const invalid = docs.filter((d) => !d || !ALL_DOCUMENT_TYPES.includes(d.documentType) || typeof d.label !== 'string' || !d.label.trim());
    if (invalid.length > 0) {
      throw new Error(`Each requiredDocuments entry needs a valid documentType (${ALL_DOCUMENT_TYPES.join(', ')}) and a label.`);
    }
    return true;
  });

const createServiceValidator = [
  body('name').isString().trim().isLength({ min: 1, max: 150 }).withMessage('Name is required.'),
  body('serviceCode')
    .isString()
    .trim()
    .toUpperCase()
    .matches(SERVICE_CODE_PATTERN)
    .withMessage('serviceCode must be 2-20 characters: uppercase letters, numbers, underscore or hyphen.'),
  body('slug')
    .optional()
    .isString()
    .trim()
    .toLowerCase()
    .matches(SLUG_PATTERN)
    .withMessage('slug must be lowercase letters/numbers separated by single hyphens.'),
  body('shortDescription').optional({ nullable: true }).isString().trim().isLength({ max: 300 }),
  body('description').optional({ nullable: true }).isString().trim().isLength({ max: 5000 }),
  body('category').optional().isIn(ALL_SERVICE_CATEGORIES),
  ...pricingFields,
  body('status').optional().isIn(ALL_SERVICE_STATUSES),
  body('sortOrder').optional().isInt({ min: 0, max: 100000 }).toInt(),
  body('isPublic').optional().isBoolean().toBoolean(),
  body('requiresKyc').optional().isBoolean().toBoolean(),
  body('requiresClientDetails').optional().isBoolean().toBoolean(),
  formSchemaField,
  requiredDocumentsField,
];

const ALLOWED_UPDATE_FIELDS = [
  'name',
  'shortDescription',
  'description',
  'category',
  'basePrice',
  'currency',
  'gstApplicable',
  'gstPercentage',
  'sortOrder',
  'isPublic',
  'requiresKyc',
  'requiresClientDetails',
];

const updateServiceValidator = [
  idParam,
  body().custom((value) => {
    const unknown = Object.keys(value || {}).filter((key) => !ALLOWED_UPDATE_FIELDS.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `These fields cannot be changed here: ${unknown.join(', ')}. serviceCode is immutable; use the dedicated status/form-schema/documents endpoints for the rest.`
      );
    }
    return true;
  }),
  body('name').optional().isString().trim().isLength({ min: 1, max: 150 }),
  body('shortDescription').optional({ nullable: true }).isString().trim().isLength({ max: 300 }),
  body('description').optional({ nullable: true }).isString().trim().isLength({ max: 5000 }),
  body('category').optional().isIn(ALL_SERVICE_CATEGORIES),
  body('basePrice').optional().isFloat({ min: 0, max: 10000000 }),
  body('currency').optional().isIn(['INR']),
  body('gstApplicable').optional().isBoolean().toBoolean(),
  body('gstPercentage').optional().isFloat({ min: 0, max: 100 }),
  body('sortOrder').optional().isInt({ min: 0, max: 100000 }).toInt(),
  body('isPublic').optional().isBoolean().toBoolean(),
  body('requiresKyc').optional().isBoolean().toBoolean(),
  body('requiresClientDetails').optional().isBoolean().toBoolean(),
];

const updateStatusValidator = [
  idParam,
  body('status').isIn(ALL_SERVICE_STATUSES).withMessage(`status must be one of: ${ALL_SERVICE_STATUSES.join(', ')}.`),
];

const updateFormSchemaValidator = [idParam, body('formSchema').custom((value) => value && typeof value === 'object'), formSchemaField];

const updateDocumentsValidator = [idParam, requiredDocumentsField];

module.exports = {
  SORT_FIELDS,
  MAX_PAGE_SIZE,
  idOnlyValidator,
  listServicesValidator,
  createServiceValidator,
  updateServiceValidator,
  updateStatusValidator,
  updateFormSchemaValidator,
  updateDocumentsValidator,
};
