/**
 * Maintenance-mode gate — ported from the standalone Portal's src/app.js.
 *
 * Mounted at /api/portal, so `req.path` is relative to it. When the Portal setting
 * `maintenance_mode` is on, every Portal API call is answered with 503 except for
 * SUPER_ADMINs and the auth/health endpoints (so a super admin can still sign in and
 * switch it off). LauncherDesk routes are not affected, as in the original setup.
 */
const { getSettingValue } = require('../../services/portal/settings.service');
const { verifyAccessToken } = require('../../services/portal/token.service');
const { ROLES } = require('../../constants/portal/roles');

module.exports = async function maintenanceModeGate(req, res, next) {
  try {
    if (req.path.startsWith('/auth') || req.path.startsWith('/health')) return next();
    const enabled = await getSettingValue('maintenance_mode');
    if (!enabled) return next();

    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Bearer' && token) {
      try {
        if (verifyAccessToken(token).role === ROLES.SUPER_ADMIN) return next();
      } catch { /* invalid token — fall through to 503 */ }
    }

    return res.status(503).json({
      success: false,
      code: 'MAINTENANCE_MODE',
      message: 'The platform is under maintenance. Please try again later.',
    });
  } catch {
    return next(); // never block requests because of a settings lookup error
  }
};
