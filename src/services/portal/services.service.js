const mongoose = require('mongoose');
const { Service, AuditLog } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { SERVICE_STATUS, isValidServiceStatusTransition } = require('../../constants/portal/serviceStatus');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const { rupeesToPaise, computePricingSummary } = require('./money.service');
const { validateFormSchema } = require('./formSchema.service');
const { logAudit } = require('./auditLog.service');

function auditCtx(actor) {
  return { actor: actor._id, actorRole: actor.role };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Full shape for internal (Super Admin / permitted Admin) consumers. */
function serializeService(service) {
  const pricing = computePricingSummary({
    basePriceMinor: service.basePriceMinor,
    gstApplicable: service.gstApplicable,
    gstPercentage: service.gstPercentage,
    currency: service.currency,
  });

  return {
    id: service._id,
    serviceCode: service.serviceCode,
    slug: service.slug,
    name: service.name,
    shortDescription: service.shortDescription || '',
    description: service.description || '',
    category: service.category,
    pricing,
    gstApplicable: service.gstApplicable,
    gstPercentage: service.gstPercentage,
    status: service.status,
    sortOrder: service.sortOrder,
    isPublic: service.isPublic,
    requiresKyc: service.requiresKyc,
    requiresClientDetails: service.requiresClientDetails,
    slaDays: service.slaDays ?? null,
    formSchema: service.formSchema || { fields: [] },
    requiredDocuments: service.requiredDocuments || [],
    createdBy: service.createdBy ?? null,
    updatedBy: service.updatedBy ?? null,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

/**
 * The ONLY shape ever returned by a client-/public-facing services
 * endpoint - no formSchema internals beyond what's needed to render the
 * form, no requiredDocuments internals, no createdBy/audit metadata.
 */
function serializePublicService(service) {
  const pricing = computePricingSummary({
    basePriceMinor: service.basePriceMinor,
    gstApplicable: service.gstApplicable,
    gstPercentage: service.gstPercentage,
    currency: service.currency,
  });

  return {
    id: service._id,
    serviceCode: service.serviceCode,
    slug: service.slug,
    name: service.name,
    shortDescription: service.shortDescription || '',
    description: service.description || '',
    category: service.category,
    pricing,
    gstApplicable: service.gstApplicable,
    gstPercentage: service.gstPercentage,
    requiresKyc: service.requiresKyc,
    requiresClientDetails: service.requiresClientDetails,
    formSchema: service.formSchema || { fields: [] },
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildListFilter({ search, status, category, isPublic, requiresKyc, minPrice, maxPrice }) {
  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (isPublic !== undefined) filter.isPublic = isPublic;
  if (requiresKyc !== undefined) filter.requiresKyc = requiresKyc;
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.basePriceMinor = {};
    if (minPrice !== undefined) filter.basePriceMinor.$gte = rupeesToPaise(minPrice);
    if (maxPrice !== undefined) filter.basePriceMinor.$lte = rupeesToPaise(maxPrice);
  }
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ serviceCode: re }, { name: re }, { slug: re }, { shortDescription: re }];
  }
  return filter;
}

async function listServices(filters, { page = 1, limit = 20, sortBy = 'sortOrder', sortDir = 'asc' } = {}) {
  const filter = buildListFilter(filters);
  const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };

  const [items, total] = await Promise.all([
    Service.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    Service.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeService),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    },
  };
}

async function getServiceById(service) {
  return serializeService(service);
}

/** Services visible to a future client-facing catalogue: ACTIVE + PUBLIC only. */
async function listPublicServices({ page = 1, limit = 20 } = {}) {
  const filter = { status: SERVICE_STATUS.ACTIVE, isPublic: true };
  const [items, total] = await Promise.all([
    Service.find(filter)
      .sort({ sortOrder: 1, name: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Service.countDocuments(filter),
  ]);
  return {
    items: items.map(serializePublicService),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/**
 * A single service for the client-facing catalogue (Phase 6 service detail
 * page). Same ACTIVE+isPublic restriction as the list, and 404s otherwise
 * rather than revealing that a private/inactive/archived service exists.
 */
async function getPublicServiceById(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw AppError.notFound();
  }
  const service = await Service.findOne({ _id: id, status: SERVICE_STATUS.ACTIVE, isPublic: true });
  if (!service) {
    throw AppError.notFound();
  }
  return serializePublicService(service);
}

function translateDuplicateKeyError(err) {
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return AppError.conflict(`A service with this ${field} already exists.`);
  }
  return err;
}

async function createService(payload, actor, meta = {}) {
  const serviceCode = String(payload.serviceCode).trim().toUpperCase();
  const slug = payload.slug ? slugify(payload.slug) : slugify(payload.name);

  const doc = {
    serviceCode,
    slug,
    name: payload.name,
    shortDescription: payload.shortDescription || '',
    description: payload.description || '',
    category: payload.category,
    basePriceMinor: rupeesToPaise(payload.basePrice),
    currency: payload.currency || 'INR',
    gstApplicable: payload.gstApplicable ?? true,
    gstPercentage: payload.gstPercentage ?? 18,
    status: payload.status || SERVICE_STATUS.ACTIVE,
    sortOrder: payload.sortOrder ?? 0,
    isPublic: payload.isPublic ?? false,
    requiresKyc: payload.requiresKyc ?? false,
    requiresClientDetails: payload.requiresClientDetails ?? true,
    formSchema: payload.formSchema || { fields: [] },
    requiredDocuments: payload.requiredDocuments || [],
    createdBy: actor._id,
    updatedBy: actor._id,
  };

  let service;
  try {
    service = await Service.create(doc);
  } catch (err) {
    throw translateDuplicateKeyError(err);
  }

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.SERVICE_CREATED,
    resourceType: 'Service',
    resourceId: service._id,
    metadata: { serviceCode: service.serviceCode, name: service.name },
    ...meta,
  });

  return serializeService(service);
}

const PLAIN_FIELDS = ['name', 'shortDescription', 'description', 'category', 'sortOrder', 'isPublic', 'requiresKyc', 'requiresClientDetails', 'slaDays'];
const PRICING_FIELDS = ['basePrice', 'currency', 'gstApplicable', 'gstPercentage'];

async function updateService(service, changes, actor, meta = {}) {
  const before = serializeService(service);
  const applied = {};

  for (const field of PLAIN_FIELDS) {
    if (changes[field] !== undefined) {
      service[field] = changes[field];
      applied[field] = true;
    }
  }

  const pricingTouched = PRICING_FIELDS.some((f) => changes[f] !== undefined);
  const visibilityTouched = changes.isPublic !== undefined;

  if (changes.basePrice !== undefined) service.basePriceMinor = rupeesToPaise(changes.basePrice);
  if (changes.currency !== undefined) service.currency = changes.currency;
  if (changes.gstApplicable !== undefined) service.gstApplicable = changes.gstApplicable;
  if (changes.gstPercentage !== undefined) service.gstPercentage = changes.gstPercentage;

  service.updatedBy = actor._id;

  try {
    await service.save();
  } catch (err) {
    throw translateDuplicateKeyError(err);
  }

  const after = serializeService(service);

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.SERVICE_UPDATED,
    resourceType: 'Service',
    resourceId: service._id,
    metadata: { fields: Object.keys(changes) },
    ...meta,
  });

  if (pricingTouched) {
    await logAudit({
      ...auditCtx(actor),
      action: AUDIT_ACTIONS.SERVICE_PRICING_UPDATED,
      resourceType: 'Service',
      resourceId: service._id,
      metadata: { before: before.pricing, after: after.pricing },
      ...meta,
    });
  }
  if (visibilityTouched) {
    await logAudit({
      ...auditCtx(actor),
      action: AUDIT_ACTIONS.SERVICE_VISIBILITY_CHANGED,
      resourceType: 'Service',
      resourceId: service._id,
      metadata: { before: before.isPublic, after: after.isPublic },
      ...meta,
    });
  }

  return after;
}

async function updateServiceStatus(service, status, actor, meta = {}) {
  if (!isValidServiceStatusTransition(service.status, status)) {
    throw AppError.invalidStateTransition(`Cannot move a service from ${service.status} to ${status}.`);
  }

  const previousStatus = service.status;
  service.status = status;
  service.updatedBy = actor._id;
  await service.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.SERVICE_STATUS_CHANGED,
    resourceType: 'Service',
    resourceId: service._id,
    metadata: { from: previousStatus, to: status },
    ...meta,
  });

  if (status === SERVICE_STATUS.ARCHIVED) {
    await logAudit({
      ...auditCtx(actor),
      action: AUDIT_ACTIONS.SERVICE_ARCHIVED,
      resourceType: 'Service',
      resourceId: service._id,
      metadata: { from: previousStatus },
      ...meta,
    });
  }

  return serializeService(service);
}

/** DELETE /api/services/:id - always archives (terminal), never destroys the record. */
async function archiveService(service, actor, meta = {}) {
  if (service.status === SERVICE_STATUS.ARCHIVED) {
    throw AppError.conflict('This service is already archived.');
  }
  return updateServiceStatus(service, SERVICE_STATUS.ARCHIVED, actor, meta);
}

async function updateFormSchema(service, formSchema, actor, meta = {}) {
  const errors = validateFormSchema(formSchema);
  if (errors.length > 0) {
    throw AppError.badRequest('Invalid form schema.', errors.map((message) => ({ field: 'formSchema', message })));
  }

  service.formSchema = { fields: formSchema.fields || [] };
  service.updatedBy = actor._id;
  await service.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.SERVICE_FORM_UPDATED,
    resourceType: 'Service',
    resourceId: service._id,
    metadata: { fieldCount: service.formSchema.fields.length },
    ...meta,
  });

  return serializeService(service);
}

async function updateRequiredDocuments(service, requiredDocuments, actor, meta = {}) {
  service.requiredDocuments = requiredDocuments;
  service.updatedBy = actor._id;
  await service.save();

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.SERVICE_DOCUMENT_REQUIREMENTS_UPDATED,
    resourceType: 'Service',
    resourceId: service._id,
    metadata: { documentCount: service.requiredDocuments.length },
    ...meta,
  });

  return serializeService(service);
}

async function getServiceActivity(serviceId, { page = 1, limit = 20 } = {}) {
  const filter = { resourceType: 'Service', resourceId: serviceId };
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

module.exports = {
  serializeService,
  serializePublicService,
  slugify,
  listServices,
  getPublicServiceById,
  listPublicServices,
  getServiceById,
  createService,
  updateService,
  updateServiceStatus,
  archiveService,
  updateFormSchema,
  updateRequiredDocuments,
  getServiceActivity,
};
