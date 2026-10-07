const servicesService = require('../../services/portal/services.service');
const { sendSuccess } = require('../../utils/portal/apiResponse');

function requestMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

function pagination(req) {
  const page = parseInt(req.query.page, 10);
  const limit = parseInt(req.query.limit, 10);
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20,
  };
}

async function list(req, res, next) {
  try {
    const { search, status, category, isPublic, requiresKyc, minPrice, maxPrice, sortBy, sortDir } = req.query;
    const result = await servicesService.listServices(
      { search, status, category, isPublic, requiresKyc, minPrice, maxPrice },
      { ...pagination(req), sortBy, sortDir }
    );
    return sendSuccess(res, { message: 'Services.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const service = await servicesService.createService(req.body, req.user, requestMeta(req));
    return sendSuccess(res, { statusCode: 201, message: 'Service created.', data: service });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const service = await servicesService.getServiceById(req.resource);
    return sendSuccess(res, { message: 'Service.', data: service });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const service = await servicesService.updateService(req.resource, req.body, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Service updated.', data: service });
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const service = await servicesService.updateServiceStatus(req.resource, req.body.status, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Service status updated.', data: service });
  } catch (err) {
    next(err);
  }
}

async function archive(req, res, next) {
  try {
    const service = await servicesService.archiveService(req.resource, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Service archived.', data: service });
  } catch (err) {
    next(err);
  }
}

async function updateFormSchema(req, res, next) {
  try {
    const service = await servicesService.updateFormSchema(req.resource, req.body.formSchema, req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Service form schema updated.', data: service });
  } catch (err) {
    next(err);
  }
}

async function updateDocuments(req, res, next) {
  try {
    const service = await servicesService.updateRequiredDocuments(req.resource, req.body.requiredDocuments || [], req.user, requestMeta(req));
    return sendSuccess(res, { message: 'Required documents updated.', data: service });
  } catch (err) {
    next(err);
  }
}

async function getActivity(req, res, next) {
  try {
    const result = await servicesService.getServiceActivity(req.resource._id, pagination(req));
    return sendSuccess(res, { message: 'Service activity.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function listPublic(req, res, next) {
  try {
    const result = await servicesService.listPublicServices(pagination(req));
    return sendSuccess(res, { message: 'Services.', data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
}

async function getPublicById(req, res, next) {
  try {
    const service = await servicesService.getPublicServiceById(req.params.id);
    return sendSuccess(res, { message: 'Service.', data: service });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  getById,
  update,
  updateStatus,
  archive,
  updateFormSchema,
  updateDocuments,
  getActivity,
  listPublic,
  getPublicById,
};
