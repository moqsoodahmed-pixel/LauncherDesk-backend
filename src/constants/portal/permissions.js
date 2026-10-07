/**
 * Granular permission catalog.
 *
 * This is the authoritative list of permissions the system understands.
 * Role/permission ASSIGNMENT (which admin has which permission) lives in
 * the database (User.permissions), not here. This file only defines what
 * permissions EXIST, grouped by domain, so middleware and future business
 * logic can reference named constants instead of magic strings.
 */

const PERMISSIONS = Object.freeze({
  // Client domain
  VIEW_CLIENT: 'VIEW_CLIENT',
  CREATE_CLIENT: 'CREATE_CLIENT',
  EDIT_CLIENT: 'EDIT_CLIENT',
  DELETE_CLIENT: 'DELETE_CLIENT',
  ASSIGN_CLIENT: 'ASSIGN_CLIENT',
  REASSIGN_CLIENT: 'REASSIGN_CLIENT',

  // Order domain
  VIEW_ORDER: 'VIEW_ORDER',
  CREATE_ORDER: 'CREATE_ORDER',
  EDIT_ORDER: 'EDIT_ORDER',
  ASSIGN_ORDER: 'ASSIGN_ORDER',
  REASSIGN_ORDER: 'REASSIGN_ORDER',
  UPDATE_ORDER_STATUS: 'UPDATE_ORDER_STATUS',
  CLOSE_ORDER: 'CLOSE_ORDER',
  CANCEL_ORDER: 'CANCEL_ORDER',

  // KYC domain
  VIEW_KYC: 'VIEW_KYC',
  UPLOAD_KYC: 'UPLOAD_KYC',
  VERIFY_KYC: 'VERIFY_KYC',
  REJECT_KYC: 'REJECT_KYC',
  DOWNLOAD_KYC: 'DOWNLOAD_KYC',
  DELETE_KYC: 'DELETE_KYC',

  // Payment domain
  VIEW_PAYMENT: 'VIEW_PAYMENT',
  VIEW_PAYMENT_DETAILS: 'VIEW_PAYMENT_DETAILS',
  REFUND_PAYMENT: 'REFUND_PAYMENT',

  // Service domain
  VIEW_SERVICE: 'VIEW_SERVICE',
  CREATE_SERVICE: 'CREATE_SERVICE',
  EDIT_SERVICE: 'EDIT_SERVICE',
  DELETE_SERVICE: 'DELETE_SERVICE',

  // Admin management domain
  VIEW_ADMINS: 'VIEW_ADMINS',
  CREATE_ADMIN: 'CREATE_ADMIN',
  EDIT_ADMIN: 'EDIT_ADMIN',
  DISABLE_ADMIN: 'DISABLE_ADMIN',
  MANAGE_ADMIN_PERMISSIONS: 'MANAGE_ADMIN_PERMISSIONS',
  ASSIGN_ADMIN_CLIENTS: 'ASSIGN_ADMIN_CLIENTS',

  // Reports
  VIEW_REPORTS: 'VIEW_REPORTS',
  EXPORT_REPORTS: 'EXPORT_REPORTS',

  // Audit
  VIEW_AUDIT_LOGS: 'VIEW_AUDIT_LOGS',

  // Settings
  VIEW_SETTINGS: 'VIEW_SETTINGS',
  MANAGE_SETTINGS: 'MANAGE_SETTINGS',

  // Tasks / Workflow
  VIEW_TASKS: 'VIEW_TASKS',
  CREATE_TASK: 'CREATE_TASK',
  MANAGE_TASKS: 'MANAGE_TASKS',

  // Notifications
  VIEW_NOTIFICATIONS: 'VIEW_NOTIFICATIONS',

  // Client self-service ("own data") permissions. These only ever grant
  // access to records belonging to the authenticated client; ownership is
  // still re-verified against the database by the data-scope layer.
  VIEW_OWN_PROFILE: 'VIEW_OWN_PROFILE',
  VIEW_OWN_ORDERS: 'VIEW_OWN_ORDERS',
  VIEW_OWN_DOCUMENTS: 'VIEW_OWN_DOCUMENTS',
  UPLOAD_OWN_DOCUMENTS: 'UPLOAD_OWN_DOCUMENTS',
  VIEW_OWN_NOTIFICATIONS: 'VIEW_OWN_NOTIFICATIONS',
});

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

/**
 * Default permission set granted to a newly created / seeded Admin.
 * Super Admin can customize per-admin afterward (Phase 2).
 * Operational, never destructive: no delete, refund, admin-management or
 * audit permissions unless explicitly granted.
 */
const DEFAULT_ADMIN_PERMISSIONS = Object.freeze([
  PERMISSIONS.VIEW_CLIENT,
  PERMISSIONS.CREATE_CLIENT,
  PERMISSIONS.EDIT_CLIENT,
  PERMISSIONS.VIEW_ORDER,
  PERMISSIONS.UPDATE_ORDER_STATUS,
  PERMISSIONS.VIEW_KYC,
  PERMISSIONS.VERIFY_KYC,
  PERMISSIONS.VIEW_SERVICE,
  PERMISSIONS.VIEW_NOTIFICATIONS,
  PERMISSIONS.VIEW_TASKS,
  PERMISSIONS.CREATE_TASK,
  PERMISSIONS.MANAGE_TASKS,
]);

/**
 * Client accounts only ever have this fixed, non-configurable set of
 * "own data" permissions. Clients are never granted admin-domain
 * permissions (VIEW_CLIENT, VIEW_ORDER, VIEW_AUDIT_LOGS, ...).
 */
const CLIENT_PERMISSIONS = Object.freeze([
  PERMISSIONS.VIEW_OWN_PROFILE,
  PERMISSIONS.VIEW_OWN_ORDERS,
  PERMISSIONS.VIEW_OWN_DOCUMENTS,
  PERMISSIONS.UPLOAD_OWN_DOCUMENTS,
  PERMISSIONS.VIEW_OWN_NOTIFICATIONS,
]);

module.exports = {
  PERMISSIONS,
  ALL_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
  CLIENT_PERMISSIONS,
};
