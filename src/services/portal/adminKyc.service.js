const { KycDocument } = require('../../models/portal');
const { KYC_DOCUMENT_STATUS, KYC_DOCUMENT_LIFECYCLE } = require('../../constants/portal/kycStatus');

function buildFilter({ status, documentType, dateFrom, dateTo, search }) {
  const filter = { lifecycleStatus: { $ne: KYC_DOCUMENT_LIFECYCLE.DELETED }, isCurrentVersion: true };

  if (status) filter.status = status;
  if (documentType) filter.documentType = documentType;

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z');
  }

  return filter;
}

function serializeKycDoc(doc) {
  const order = doc.order || {};
  const client = doc.client || {};
  const assignedAdmin = order.assignedAdmin || null;
  const reviewedBy = doc.reviewedBy || null;
  const uploadedBy = doc.uploadedBy || null;

  return {
    id: String(doc._id),
    kycCode: doc.kycCode || null,
    documentType: doc.documentType,
    version: doc.version,
    status: doc.status,
    originalFileName: doc.originalFileName,
    sizeBytes: doc.sizeBytes,
    mimeType: doc.mimeType,
    rejectionReason: doc.rejectionReason || null,
    reviewedAt: doc.reviewedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,

    orderId: order._id ? String(order._id) : null,
    orderCode: order.orderCode || null,
    invoiceNumber: order.invoiceNumber || null,
    orderStatus: order.status || null,

    clientId: client._id ? String(client._id) : null,
    clientCode: client.clientCode || null,
    clientName: client.name || null,
    companyName: client.companyName || null,
    clientEmail: client.email || null,

    assignedAdmin: assignedAdmin
      ? { id: String(assignedAdmin._id), name: assignedAdmin.name, adminCode: assignedAdmin.adminCode }
      : null,

    reviewedBy: reviewedBy ? { id: String(reviewedBy._id), name: reviewedBy.name } : null,
    uploadedBy: uploadedBy ? { id: String(uploadedBy._id), name: uploadedBy.name } : null,
  };
}

async function listKycDocuments({ page = 1, limit = 20, sortBy = 'createdAt', sortDir = 'desc', status, documentType, dateFrom, dateTo, search } = {}) {
  const filter = buildFilter({ status, documentType, dateFrom, dateTo });

  // Text search is applied post-populate via JS filtering when needed.
  // For large datasets this should be an Atlas Search index; at current scale it's fine.
  const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };
  const skip = (page - 1) * limit;

  let query = KycDocument.find(filter)
    .populate({ path: 'order', select: 'orderCode invoiceNumber status assignedAdmin', populate: { path: 'assignedAdmin', select: 'name adminCode' } })
    .populate({ path: 'client', select: 'name clientCode companyName email' })
    .populate({ path: 'reviewedBy', select: 'name' })
    .populate({ path: 'uploadedBy', select: 'name' })
    .sort(sort)
    .lean();

  let docs = await query;

  // Apply text search in-memory (matches clientCode, clientName, companyName, orderCode, kycCode, documentType)
  if (search) {
    const q = search.toLowerCase();
    docs = docs.filter((d) => {
      const client = d.client || {};
      const order = d.order || {};
      return (
        (d.kycCode && d.kycCode.toLowerCase().includes(q)) ||
        (d.legacyKycCode && d.legacyKycCode.toLowerCase().includes(q)) ||
        (client.clientCode && client.clientCode.toLowerCase().includes(q)) ||
        (client.legacyClientCode && client.legacyClientCode.toLowerCase().includes(q)) ||
        (client.name && client.name.toLowerCase().includes(q)) ||
        (client.companyName && client.companyName.toLowerCase().includes(q)) ||
        (client.email && client.email.toLowerCase().includes(q)) ||
        (order.orderCode && order.orderCode.toLowerCase().includes(q)) ||
        (order.legacyOrderCode && order.legacyOrderCode.toLowerCase().includes(q)) ||
        (d.documentType && d.documentType.toLowerCase().includes(q))
      );
    });
  }

  const total = docs.length;
  const paginated = docs.slice(skip, skip + limit);

  return {
    items: paginated.map(serializeKycDoc),
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  };
}

async function getKycStats() {
  const base = { lifecycleStatus: { $ne: KYC_DOCUMENT_LIFECYCLE.DELETED }, isCurrentVersion: true };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  const [counts, verifiedToday, verifiedWeek, avgTime, documentTypeAgg, businessTypeAgg, unassigned] = await Promise.all([
    KycDocument.aggregate([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    KycDocument.countDocuments({ ...base, status: KYC_DOCUMENT_STATUS.VERIFIED, reviewedAt: { $gte: today } }),
    KycDocument.countDocuments({ ...base, status: KYC_DOCUMENT_STATUS.VERIFIED, reviewedAt: { $gte: startOfWeek } }),
    KycDocument.aggregate([
      { $match: { ...base, status: KYC_DOCUMENT_STATUS.VERIFIED, reviewedAt: { $ne: null } } },
      {
        $project: {
          diffMs: { $subtract: ['$reviewedAt', '$createdAt'] },
        },
      },
      { $group: { _id: null, avgMs: { $avg: '$diffMs' } } },
    ]),
    // Wave 2 analytics addition: counts by document type.
    KycDocument.aggregate([
      { $match: base },
      { $group: { _id: '$documentType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    // Wave 2 analytics addition: counts by the owning client's businessType
    // (Part 5/Wave 1's new, nullable Client.businessType field - a client
    // with it unset groups under 'UNSPECIFIED').
    KycDocument.aggregate([
      { $match: base },
      { $lookup: { from: 'portal_clients', localField: 'client', foreignField: '_id', as: 'clientDoc' } },
      { $unwind: { path: '$clientDoc', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ['$clientDoc.businessType', 'UNSPECIFIED'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    // Frontend (super-admin/admin KycListPage.jsx) stat tile addition: how
    // many documents still awaiting a decision (UPLOADED/UNDER_REVIEW) have
    // no reviewer assigned yet - this previously had no backing field and
    // always rendered '-' on both KYC list pages.
    KycDocument.countDocuments({
      ...base,
      status: { $in: [KYC_DOCUMENT_STATUS.UPLOADED, KYC_DOCUMENT_STATUS.UNDER_REVIEW] },
      assignedReviewer: null,
    }),
  ]);

  const byStatus = {};
  for (const { _id, count } of counts) byStatus[_id] = count;

  const total = Object.values(byStatus).reduce((s, c) => s + c, 0);

  const avgMs = avgTime[0]?.avgMs || 0;
  const avgHours = Math.round(avgMs / 3600000);
  const avgLabel = avgHours < 24 ? `${avgHours}h` : `${Math.round(avgHours / 24)}d`;

  return {
    total,
    uploaded: byStatus[KYC_DOCUMENT_STATUS.UPLOADED] || 0,
    underReview: byStatus[KYC_DOCUMENT_STATUS.UNDER_REVIEW] || 0,
    verified: byStatus[KYC_DOCUMENT_STATUS.VERIFIED] || 0,
    rejected: byStatus[KYC_DOCUMENT_STATUS.REJECTED] || 0,
    verifiedToday,
    verifiedWeek,
    avgVerificationTime: avgLabel,
    // Wave 2 additions - purely additive fields, existing fields above are
    // untouched so no existing consumer of this response shape breaks.
    needReupload: byStatus[KYC_DOCUMENT_STATUS.NEED_REUPLOAD] || 0,
    avgTurnaroundHours: Math.round(avgMs / 360000) / 10, // one decimal place
    byDocumentType: documentTypeAgg.map((d) => ({ documentType: d._id, count: d.count })),
    byBusinessType: businessTypeAgg.map((d) => ({ businessType: d._id, count: d.count })),
    unassigned,
  };
}

module.exports = { listKycDocuments, getKycStats };
