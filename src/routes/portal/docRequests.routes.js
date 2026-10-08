'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true }); // orderId from parent

const authenticate = require('../../middleware/portal/authenticate');
const requireRole = require('../../middleware/portal/requireRole');
const { ROLES } = require('../../constants/portal/roles');
const { DocRequest, Order } = require('../../models/portal');
const AppError = require('../../utils/portal/AppError');
const { sendSuccess } = require('../../utils/portal/apiResponse');
const notificationService = require('../../services/portal/notification.service');
const communicationService = require('../../services/portal/communication.service');
const { generateDocRequestCode } = require('../../services/portal/idGenerator.service');

// Staff routes — list and create requests
const staffRouter = express.Router({ mergeParams: true });
staffRouter.use(authenticate, requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN));

staffRouter.get('/', async (req, res, next) => {
  try {
    const requests = await DocRequest.find({ order: req.params.orderId })
      .populate('requestedBy', 'name adminCode')
      .populate('linkedKycDocument', 'documentType version status originalFileName')
      .sort({ createdAt: -1 });
    sendSuccess(res, { message: 'Doc requests fetched.', data: requests });
  } catch (err) {
    next(err);
  }
});

staffRouter.post('/', async (req, res, next) => {
  try {
    const { documentType, label, instructions } = req.body;
    if (!documentType) throw AppError.badRequest('documentType is required.');
    if (!label || !label.trim()) throw AppError.badRequest('label is required.');

    const order = await Order.findById(req.params.orderId).populate('client');
    if (!order) throw AppError.notFound('Order not found.');

    const docRequestCode = await generateDocRequestCode();
    const docReq = await DocRequest.create({
      docRequestCode,
      order: order._id,
      client: order.client._id,
      requestedBy: req.user._id,
      documentType,
      label: label.trim(),
      instructions: instructions?.trim() || '',
    });

    // Notify the client (non-blocking)
    notificationService.createNotification({
      recipientUserId: order.client.user,
      type: 'DOC_REQUESTED',
      title: 'Document Requested',
      message: `Please upload: ${label}${instructions ? '. ' + instructions : ''}.`,
      link: `/client/orders/${order._id}`,
      metadata: { orderId: order._id, documentType },
    }).catch(() => {});

    communicationService.sendDocumentRequested(order, docReq).catch(() => {});

    await docReq.populate('requestedBy', 'name adminCode');
    sendSuccess(res, { statusCode: 201, message: 'Document request created.', data: docReq });
  } catch (err) {
    next(err);
  }
});

staffRouter.patch('/:reqId', async (req, res, next) => {
  try {
    const docReq = await DocRequest.findOne({ _id: req.params.reqId, order: req.params.orderId });
    if (!docReq) throw AppError.notFound('Document request not found.');
    const { status } = req.body;
    if (!['CANCELLED', 'FULFILLED'].includes(status)) throw AppError.badRequest('Invalid status.');
    docReq.status = status;
    if (status === 'CANCELLED') {
      docReq.cancelledAt = new Date();
      docReq.cancelledBy = req.user._id;
    }
    await docReq.save();

    if (status === 'FULFILLED') {
      const order = await Order.findById(req.params.orderId).populate('client');
      if (order) {
        notificationService.createNotification({
          recipientUserId: order.client.user,
          type: 'DOC_FULFILLED',
          title: 'Document Received',
          message: `Your ${docReq.label} has been received.`,
          link: `/client/orders/${order._id}`,
          metadata: { orderId: order._id, documentType: docReq.documentType },
        }).catch(() => {});
        communicationService.sendDocumentFulfilled(order, docReq).catch(() => {});
      }
    }

    sendSuccess(res, { message: 'Document request updated.', data: docReq });
  } catch (err) {
    next(err);
  }
});

// Client route — see their pending doc requests
const clientRouter = express.Router({ mergeParams: true });
clientRouter.use(authenticate, requireRole(ROLES.CLIENT));

clientRouter.get('/', async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, client: req.user.clientProfile });
    if (!order) throw AppError.notFound('Order not found.');
    const requests = await DocRequest.find({ order: order._id, status: 'PENDING' })
      .populate('requestedBy', 'name')
      .sort({ createdAt: -1 });
    sendSuccess(res, { message: 'Document requests fetched.', data: requests });
  } catch (err) {
    next(err);
  }
});

module.exports = { staffRouter, clientRouter };
