/**
 * Portal-specific environment configuration.
 * Mirrors LauncherDesk-portal/backend/src/config/env.js but reads from the
 * unified main backend .env file (PORTAL_ prefixed vars where they conflict).
 */

function required(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

const env = {
  NODE_ENV: required('NODE_ENV', 'development'),

  MONGODB_URI: required('MONGO_URI', required('MONGODB_URI', 'mongodb://127.0.0.1:27017/launcherdesk')),

  JWT_ACCESS_SECRET: required('PORTAL_JWT_ACCESS_SECRET', required('JWT_ACCESS_SECRET', required('JWT_SECRET', 'portal_dev_access_secret_change_me'))),
  JWT_REFRESH_SECRET: required('PORTAL_JWT_REFRESH_SECRET', required('JWT_REFRESH_SECRET', process.env.JWT_SECRET ? process.env.JWT_SECRET + '_portal_refresh' : 'portal_dev_refresh_secret_change_me')),
  JWT_ACCESS_EXPIRES: required('PORTAL_JWT_ACCESS_EXPIRES', required('JWT_ACCESS_EXPIRES', '15m')),
  JWT_REFRESH_EXPIRES: required('PORTAL_JWT_REFRESH_EXPIRES', required('JWT_REFRESH_EXPIRES', '7d')),

  PASSWORD_RESET_EXPIRES_MINUTES: parseInt(required('PASSWORD_RESET_EXPIRES_MINUTES', '60'), 10),
  MAX_FAILED_LOGIN_ATTEMPTS: parseInt(required('MAX_FAILED_LOGIN_ATTEMPTS', '5'), 10),
  ACCOUNT_LOCK_MINUTES: parseInt(required('ACCOUNT_LOCK_MINUTES', '30'), 10),

  CLIENT_URL: required('CLIENT_URL', 'http://localhost:5173'),
  SUPPORT_EMAIL: required('SUPPORT_EMAIL', 'contact@launcherdesk.com'),

  RAZORPAY_KEY_ID: required('RAZORPAY_KEY_ID', ''),
  RAZORPAY_KEY_SECRET: required('RAZORPAY_KEY_SECRET', ''),
  RAZORPAY_WEBHOOK_SECRET: required('RAZORPAY_WEBHOOK_SECRET', ''),

  BREVO_API_KEY: required('BREVO_API_KEY', ''),
  BREVO_SENDER_EMAIL: required('BREVO_SENDER_EMAIL', 'no-reply@launcherdesk.com'),
  BREVO_SENDER_NAME: required('BREVO_SENDER_NAME', 'LauncherDesk'),

  MSG91_AUTH_KEY: required('MSG91_AUTH_KEY', ''),
  MSG91_SENDER_ID: required('MSG91_SENDER_ID', ''),
  MSG91_WHATSAPP_INTEGRATED_NUMBER: required('MSG91_WHATSAPP_INTEGRATED_NUMBER', ''),
  MSG91_WHATSAPP_NAMESPACE: required('MSG91_WHATSAPP_NAMESPACE', ''),
  MSG91_WHATSAPP_TEMPLATE_NAME: required('MSG91_WHATSAPP_TEMPLATE_NAME', ''),

  STORAGE_PROVIDER: required('PORTAL_STORAGE_PROVIDER', required('STORAGE_PROVIDER', 'local')),
  STORAGE_BUCKET: required('STORAGE_BUCKET', ''),
  STORAGE_ACCESS_KEY: required('STORAGE_ACCESS_KEY', ''),
  STORAGE_SECRET_KEY: required('STORAGE_SECRET_KEY', ''),
  STORAGE_REGION: required('STORAGE_REGION', 'ap-south-1'),
  STORAGE_ENDPOINT: required('STORAGE_ENDPOINT', ''),
  LOCAL_STORAGE_PATH: required('PORTAL_LOCAL_STORAGE_PATH', './private_uploads/portal_kyc'),

  // Part 5 enterprise KYC additions. Plug-and-play: all default to '' /
  // 'disabled' so nothing changes until the user sets real values.
  CLOUDINARY_CLOUD_NAME: required('CLOUDINARY_CLOUD_NAME', ''),
  CLOUDINARY_API_KEY: required('CLOUDINARY_API_KEY', ''),
  CLOUDINARY_API_SECRET: required('CLOUDINARY_API_SECRET', ''),

  OCR_PROVIDER: required('OCR_PROVIDER', 'disabled'),
  ANTIVIRUS_PROVIDER: required('ANTIVIRUS_PROVIDER', 'disabled'),

  RETENTION_DAYS: parseInt(required('RETENTION_DAYS', '30'), 10),
  BCRYPT_ROUNDS: parseInt(required('BCRYPT_ROUNDS', '12'), 10),
  MAX_KYC_FILE_SIZE_MB: parseInt(required('PORTAL_MAX_KYC_FILE_SIZE_MB', required('MAX_KYC_FILE_SIZE_MB', '10')), 10),

  RATE_LIMIT_WINDOW_MS: parseInt(required('RATE_LIMIT_WINDOW_MS', '900000'), 10),
  RATE_LIMIT_MAX: parseInt(required('RATE_LIMIT_MAX', '300'), 10),
  LOGIN_RATE_LIMIT_MAX: parseInt(required('PORTAL_LOGIN_RATE_LIMIT_MAX', '10'), 10),

  // Grace period (seconds) within which a previously-rotated refresh token is
  // treated as a harmless concurrent request rather than token theft.
  // Covers React StrictMode double-mounts, parallel browser tabs, and the
  // apiClient interceptor racing with the auth-context mount-refresh.
  REFRESH_REUSE_GRACE_SECONDS: parseInt(required('REFRESH_REUSE_GRACE_SECONDS', '30'), 10),

  SEED: {
    superAdmin: {
      name: required('SEED_SUPER_ADMIN_NAME', 'Super Admin'),
      email: required('SEED_SUPER_ADMIN_EMAIL', 'superadmin@launcherdesk.com'),
      password: required('SEED_SUPER_ADMIN_PASSWORD', 'SuperAdmin@2026'),
    },
    admin: {
      name: required('SEED_ADMIN_NAME', 'Portal Admin'),
      email: required('SEED_ADMIN_EMAIL', 'portaladmin@launcherdesk.com'),
      password: required('SEED_ADMIN_PASSWORD', 'Admin@2026'),
    },
    client: {
      name: required('SEED_CLIENT_NAME', 'Demo Client'),
      email: required('SEED_CLIENT_EMAIL', 'client@launcherdesk.com'),
      password: required('SEED_CLIENT_PASSWORD', 'Client@2026'),
    },
  },

  get isProduction() { return this.NODE_ENV === 'production'; },
  get isDevelopment() { return this.NODE_ENV !== 'production'; },
};

module.exports = env;
