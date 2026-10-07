const { User } = require('../../models/portal');
const { CLIENT_STATUS_TO_USER_STATUS } = require('../../constants/portal/clientStatus');
const { USER_STATUS } = require('../../constants/portal/userStatus');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');
const tokenService = require('./token.service');
const { logAudit } = require('./auditLog.service');

/**
 * Keeps a Client's business status and its linked User account's auth
 * status logically coherent. This is the ONLY place that derives a
 * Client's auth status from its business status - nothing else should
 * write `User.status` for a CLIENT-role account.
 *
 * Only a Client whose business status is ACTIVE may authenticate; every
 * other business status maps to a non-ACTIVE auth status (see
 * constants/clientStatus.js). Moving away from ACTIVE also revokes every
 * existing session immediately, the same way Admin status changes do.
 */
async function syncClientAuthStatus(client, actor, meta = {}) {
  if (!client.user) return null;

  const user = await User.findById(client.user);
  if (!user) return null;

  const nextUserStatus = CLIENT_STATUS_TO_USER_STATUS[client.status] || USER_STATUS.DISABLED;
  if (user.status === nextUserStatus) return user;

  const previousUserStatus = user.status;
  user.status = nextUserStatus;

  if (nextUserStatus !== USER_STATUS.ACTIVE) {
    await tokenService.revokeAllUserTokens(user._id);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
  }
  await user.save();

  await logAudit({
    actor: actor._id,
    actorRole: actor.role,
    action: AUDIT_ACTIONS.CLIENT_AUTH_STATUS_CHANGED,
    resourceType: 'User',
    resourceId: user._id,
    metadata: { clientId: String(client._id), clientStatus: client.status, from: previousUserStatus, to: nextUserStatus },
    ...meta,
  });

  return user;
}

module.exports = { syncClientAuthStatus };
