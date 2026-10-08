'use strict';

const mongoose = require('mongoose');
const { User: PortalUser, Client: PortalClient } = require('../../models/portal');
const { hashPassword } = require('./password.service');
const { generateAdminCode, generateClientCode } = require('./idGenerator.service');
const { ALL_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } = require('../../constants/portal/permissions');
const { ROLES } = require('../../constants/portal/roles');
const { USER_STATUS } = require('../../constants/portal/userStatus');
const portalAuth = require('./auth.service');
const tokenService = require('./token.service');
const { routeForRole } = require('../../config/roleRouting');
const { REFRESH_COOKIE_NAME, refreshCookieOptions } = require('../../controllers/portal/auth.controller');

const PORTAL_ROLES_SET = new Set(['USER', 'CLIENT', 'ADMIN', 'SUPER_ADMIN']);

function isPortalRole(role) {
  if (!role) return false;
  return PORTAL_ROLES_SET.has(String(role).toUpperCase());
}

/**
 * Ensures a PortalUser (and PortalClient if CLIENT) exists for the given user,
 * synchronizes status/password if appropriate, issues Portal JWT tokens (access + refresh),
 * sets the httpOnly refresh cookie on the response, and returns the standard Portal login response payload.
 */
async function issuePortalSession({ user, rawPassword = null, req, res, targetRoleOverride = null }) {
  const normalizedEmail = String(user.email).toLowerCase().trim();
  const isSuperAdminEmail = normalizedEmail === 'moqsood@launcherdesk.com' || normalizedEmail === (process.env.ADMIN_EMAIL || '').toLowerCase();

  let targetRole = targetRoleOverride;
  if (!targetRole) {
    const roleUpper = String(user.role || '').toUpperCase();
    if (isSuperAdminEmail || roleUpper === 'SUPER_ADMIN') {
      targetRole = ROLES.SUPER_ADMIN;
    } else if (roleUpper === 'ADMIN') {
      targetRole = ROLES.ADMIN;
    } else {
      targetRole = ROLES.CLIENT;
    }
  }

  const targetPerms = targetRole === ROLES.SUPER_ADMIN
    ? ALL_PERMISSIONS
    : targetRole === ROLES.ADMIN
      ? DEFAULT_ADMIN_PERMISSIONS
      : undefined;

  let portalUser = await PortalUser.findOne({ email: normalizedEmail }).select('+passwordHash');

  if (!portalUser) {
    const pwHash = rawPassword ? await hashPassword(rawPassword) : (user.password || await hashPassword(require('crypto').randomUUID()));
    const createData = {
      name: user.name || (targetRole === ROLES.SUPER_ADMIN ? 'Super Admin' : targetRole === ROLES.ADMIN ? 'Admin' : 'Client'),
      email: normalizedEmail,
      passwordHash: pwHash,
      role: targetRole,
      status: USER_STATUS.ACTIVE,
      tokenVersion: 0,
      notificationPreferences: { inAppEnabled: true },
    };
    if (targetPerms) createData.permissions = targetPerms;
    if (targetRole === ROLES.ADMIN || targetRole === ROLES.SUPER_ADMIN) {
      createData.adminCode = await generateAdminCode();
    }
    portalUser = await PortalUser.create(createData);

    if (targetRole === ROLES.CLIENT) {
      const clientCode = await generateClientCode();
      const clientDoc = await PortalClient.create({
        clientCode,
        user: portalUser._id,
        name: user.name || 'Client',
        companyName: user.name || 'Client',
        email: normalizedEmail,
        phone: user.phone || '',
        status: 'ACTIVE',
      });
      portalUser.clientProfile = clientDoc._id;
      await portalUser.save();

      // Part 1 of the transactional-email brief: this is the other authoritative
      // place (besides authController.register) a brand-new CLIENT portal_user
      // is created - the first-ever login of a pre-existing LauncherDesk User
      // account. Never blocks the login it was triggered from.
      require('./communication.service').sendClientWelcome(portalUser, clientDoc).catch(() => {});
    }
  } else {
    // Portal user exists: ensure active and update role/permissions if upgraded
    portalUser.status = USER_STATUS.ACTIVE;
    if (targetPerms && portalUser.role !== targetRole) {
      portalUser.role = targetRole;
      portalUser.permissions = targetPerms;
    }
    if (rawPassword) {
      portalUser.passwordHash = await hashPassword(rawPassword);
    }
    await portalUser.save();
  }

  // Issue real Portal access token + refresh token
  const accessToken = tokenService.signAccessToken(portalUser);
  const refreshToken = await tokenService.issueRefreshToken(portalUser, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Set the refresh cookie
  if (res && typeof res.cookie === 'function') {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  }

  const route = routeForRole(portalUser.role);
  const safeUser = portalAuth.serializeUser(portalUser);

  return {
    success: true,
    userType: 'portal',
    workspace: route.workspace,
    role: portalUser.role,
    roleLabel: route.label,
    redirect: route.home,
    redirectTo: route.home,
    permissions: safeUser.permissions,
    accessToken,
    token: accessToken,
    refreshToken,
    refreshTokenDelivery: 'httpOnly-cookie',
    user: safeUser,
  };
}

module.exports = {
  isPortalRole,
  issuePortalSession,
};
