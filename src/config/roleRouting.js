/**
 * Role → workspace routing — the ONE place the backend decides where a user lands.
 *
 * The unified login (POST /api/auth/login) returns `redirect` from this table, so the
 * frontend never guesses. To add a future role: add one entry here and one route
 * (with a guard) in the frontend's App.jsx.
 *
 *   workspace 'launcherdesk' → LauncherDesk UI (customer / partner / sales / internal admin)
 *   workspace 'portal'       → original Portal UI (DashboardLayout + Portal pages)
 */
const ROLE_ROUTES = {
  // LauncherDesk roles (User model, `users` collection)
  user:        { label: 'Portal Client',      workspace: 'portal',       home: '/client/dashboard' },
  partner:     { label: 'Partner',            workspace: 'launcherdesk', home: '/partner/dashboard' },
  sales:       { label: 'Sales',              workspace: 'launcherdesk', home: '/sales/dashboard' },
  admin:       { label: 'Portal Admin',       workspace: 'portal',       home: '/admin/dashboard' },
  super_admin: { label: 'Portal Super Admin', workspace: 'portal',       home: '/super-admin/dashboard' },

  // Portal roles (PortalUser model, `portal_users` collection)
  CLIENT:      { label: 'Portal Client',      workspace: 'portal', home: '/client/dashboard' },
  ADMIN:       { label: 'Portal Admin',       workspace: 'portal', home: '/admin/dashboard' },
  SUPER_ADMIN: { label: 'Portal Super Admin', workspace: 'portal', home: '/super-admin/dashboard' },
}

const DEFAULT_ROUTE = ROLE_ROUTES.user

function routeForRole(role) {
  return ROLE_ROUTES[role] || DEFAULT_ROUTE
}

module.exports = { ROLE_ROUTES, routeForRole }
