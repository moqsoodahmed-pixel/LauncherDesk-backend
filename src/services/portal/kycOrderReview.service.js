const { ORDER_STATUS } = require('../../constants/portal/orderStatus');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const AppError = require('../../utils/portal/AppError');
const { transitionOrderStatus } = require('./orderStateMachine.service');
const kycState = require('./kycState.service');
const { logAudit } = require('./auditLog.service');

/**
 * Wave 2 addition: ORDER-level "approve complete KYC" / "reject complete
 * KYC" - distinct from kyc.service.js's per-document verifyDocument/
 * rejectDocument. These act on the order as a whole, in one call, instead
 * of a reviewer clicking verify on every required document one at a time.
 *
 * Both reuse the EXISTING order-transition machinery exclusively
 * (orderStateMachine.service.js's transitionOrderStatus, via
 * kycState.service.js's reconcileOrderAfterDocumentDecision for the
 * approve path) - neither hand-rolls a parallel order-status writer, and
 * neither duplicates the communication/notification dispatch that
 * transitionOrderStatus's own notifyStatusChange already fires for every
 * KYC_VERIFICATION -> IN_PROGRESS / -> KYC_REJECTED transition (see
 * orderStateMachine.service.js lines ~131-142).
 */

function auditCtx(actor) {
  return { actor: actor._id, actorRole: actor.role };
}

/**
 * Approves the order's KYC as a whole. Requires the order to currently be
 * under review (KYC_VERIFICATION) and EVERY mandatory required document to
 * already be individually VERIFIED - this does NOT itself verify any
 * document; it only moves the ORDER forward once the documents already are.
 * If any required document isn't yet VERIFIED, this fails loudly (400) and
 * reports exactly which ones, rather than silently forcing the order
 * forward (that "force" behavior is a separate, Super-Admin-only,
 * per-document capability - see kyc.service.js's forceApproveDocument).
 */
async function approveCompleteKyc({ order, actor, meta = {} }) {
  if (order.status !== ORDER_STATUS.KYC_VERIFICATION) {
    throw AppError.badRequest('This order is not currently under KYC review.');
  }

  const required = (order.serviceSnapshot?.requiredDocuments || []).filter((d) => d.mandatory !== false);
  const documents = await kycState.getCurrentDocuments(order._id);
  const byType = new Map(documents.map((d) => [d.documentType, d]));

  const notReady = [];
  for (const r of required) {
    const doc = byType.get(r.documentType);
    if (!doc) {
      notReady.push({ documentType: r.documentType, status: 'NOT_UPLOADED' });
    } else if (doc.status !== 'VERIFIED') {
      notReady.push({ documentType: r.documentType, status: doc.status });
    }
  }

  if (notReady.length > 0) {
    throw AppError.badRequest(
      `Cannot approve complete KYC - ${notReady.length} required document(s) are not yet verified.`,
      { notReady }
    );
  }

  // All required documents are VERIFIED - reuse the existing reconciliation
  // path (same one verifyDocument/rejectDocument call after every single
  // decision) to move the order from KYC_VERIFICATION to IN_PROGRESS. This
  // itself triggers the existing KYC_VERIFIED communication/notification
  // (orderStateMachine.service.js's notifyStatusChange, fired for every
  // KYC_VERIFICATION -> IN_PROGRESS transition) - never called a second
  // time from here.
  const updatedOrder = await kycState.reconcileOrderAfterDocumentDecision(order, actor, meta);

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.KYC_ORDER_APPROVED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { requiredDocumentCount: required.length, resultingOrderStatus: updatedOrder.status },
    ...meta,
  });

  return updatedOrder;
}

/**
 * Rejects the order's KYC as a whole, moving it directly to KYC_REJECTED -
 * regardless of any individual document's current status - via the
 * existing transitionOrderStatus. That single call already dispatches the
 * existing communicationService.sendKycRejected / notificationEventsService
 * .notifyKycRejected (see orderStateMachine.service.js's notifyStatusChange,
 * `toStatus === ORDER_STATUS.KYC_REJECTED` branch) - this function
 * deliberately does NOT call them again itself, to avoid a duplicate send.
 */
async function rejectCompleteKyc({ order, actor, reason, meta = {} }) {
  if (order.status !== ORDER_STATUS.KYC_VERIFICATION) {
    throw AppError.badRequest('This order is not currently under KYC review.');
  }
  if (!reason || !reason.trim()) {
    throw AppError.badRequest('A rejection reason is required.');
  }

  const updatedOrder = await transitionOrderStatus({
    orderId: order._id,
    toStatus: ORDER_STATUS.KYC_REJECTED,
    changedBy: actor._id,
    reason: reason.trim(),
  });

  await logAudit({
    ...auditCtx(actor),
    action: AUDIT_ACTIONS.KYC_ORDER_REJECTED,
    resourceType: 'Order',
    resourceId: order._id,
    metadata: { reason: reason.trim() },
    ...meta,
  });

  return updatedOrder;
}

module.exports = { approveCompleteKyc, rejectCompleteKyc };
