const mongoose = require('mongoose');
const { ROLES, ALL_ROLES } = require('../../constants/portal/roles');
const { ALL_PERMISSIONS } = require('../../constants/portal/permissions');
const { DATA_SCOPES } = require('../../constants/portal/dataScopes');
const authorization = require('../../services/portal/authorization.service');
const { ALL_USER_STATUSES, USER_STATUS } = require('../../constants/portal/userStatus');

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: { type: String, trim: true, default: null },
    passwordHash: { type: String, required: true, select: false },

    role: {
      type: String,
      enum: ALL_ROLES,
      required: true,
      index: true,
    },

    // Human-readable admin identifier — LD-YYYY-MMDD-#### format. Server-generated only.
    // Only set for ADMIN and SUPER_ADMIN roles; omitted for CLIENT.
    adminCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    legacyAdminCode: { type: String, default: null, index: true },
    legacyCode: { type: String, default: null, index: true },

    // Admin-specific fields (ignored for SUPER_ADMIN / CLIENT roles)
    department: { type: String, default: null },
    permissions: {
      type: [{ type: String, enum: ALL_PERMISSIONS }],
      default: [],
    },
    dataScope: {
      clients: {
        type: String,
        enum: Object.values(DATA_SCOPES),
        default: DATA_SCOPES.ONLY_ASSIGNED_CLIENTS,
      },
      orders: {
        type: String,
        enum: Object.values(DATA_SCOPES),
        default: DATA_SCOPES.ASSIGNED_ORDERS,
      },
    },
    assignedClients: [{ type: Schema.Types.ObjectId, ref: 'PortalClient' }],

    // Link to the Client document when role === CLIENT
    clientProfile: { type: Schema.Types.ObjectId, ref: 'PortalClient', default: null },

    status: {
      type: String,
      enum: ALL_USER_STATUSES,
      default: USER_STATUS.ACTIVE,
      index: true,
    },

    // Bumped on logout-all / password change / reset / disable. Embedded in
    // the access token so those events invalidate outstanding access tokens
    // immediately instead of at expiry.
    tokenVersion: { type: Number, default: 0 },
    passwordChangedAt: { type: Date, default: null },

    // Phase 10: minimal, non-marketing preference. Security-critical
    // notifications (PASSWORD_CHANGED, SECURITY_EVENT) are never
    // suppressible - notification.service.js checks MANDATORY_NOTIFICATION_EVENTS
    // before ever honoring this flag.
    notificationPreferences: {
      inAppEnabled: { type: Boolean, default: true },
    },

    lastLogin: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'PortalUser', default: null },
  },
  { timestamps: true, collection: 'portal_users' }
);

userSchema.index({ role: 1, status: 1 });

userSchema.methods.isSuperAdmin = function isSuperAdmin() {
  return this.role === ROLES.SUPER_ADMIN;
};

userSchema.methods.hasPermission = function hasPermission(permission) {
  return authorization.hasPermission(this, permission);
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.model('PortalUser', userSchema);
