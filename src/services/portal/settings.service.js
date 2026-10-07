'use strict';

const { SystemSetting } = require('../../models/portal');
const { logAudit } = require('./auditLog.service');
const { AUDIT_ACTIONS } = require('../../constants/portal/auditActions');

/**
 * In-process defaults used when a key has not been saved to the database yet.
 * A Super Admin can override any value via PUT /settings; overrides persist
 * in SystemSetting. Callers always see the merged result.
 */
const DEFAULTS = {
  // ── Company ──────────────────────────────────────────────────────────────
  company_name:              { value: 'LauncherDesk',                  label: 'Company Name',              group: 'Company',          type: 'string',  description: 'Displayed on invoices, emails, and all public-facing pages.' },
  company_address:           { value: '',                               label: 'Company Address',           group: 'Company',          type: 'string',  description: 'Printed on invoices and official documents.' },
  company_website:           { value: '',                               label: 'Company Website',           group: 'Company',          type: 'string',  description: 'Linked from client portal footer and email footers.' },
  company_email:             { value: 'support@launcherdesk.com',       label: 'Company Email',             group: 'Company',          type: 'string',  description: 'Primary contact email shown on invoices and error pages.' },
  company_phone:             { value: '',                               label: 'Company Phone',             group: 'Company',          type: 'string',  description: 'Support contact phone shown on invoices.' },
  company_gst_number:        { value: '',                               label: 'GST Number',                group: 'Company',          type: 'string',  description: 'Company GSTIN shown on invoices.' },
  company_pan:               { value: '',                               label: 'PAN',                       group: 'Company',          type: 'string',  description: 'Company PAN for tax purposes.' },
  business_registration:     { value: '',                               label: 'Business Registration No.', group: 'Company',          type: 'string',  description: 'CIN or other registration identifier for official documents.' },
  currency:                  { value: 'INR',                            label: 'Currency Code',             group: 'Company',          type: 'string',  description: 'ISO 4217 currency code (e.g. INR, USD).' },
  timezone:                  { value: 'Asia/Kolkata',                   label: 'Timezone',                  group: 'Company',          type: 'string',  description: 'IANA timezone identifier (e.g. Asia/Kolkata).' },
  date_format:               { value: 'DD/MM/YYYY',                     label: 'Date Format',               group: 'Company',          type: 'string',  description: 'Display format for dates across the platform.' },
  time_format:               { value: '12h',                            label: 'Time Format',               group: 'Company',          type: 'string',  description: '12h or 24h display format for times.' },
  gst_rate:                  { value: 18,                               label: 'GST Rate (%)',              group: 'Company',          type: 'number',  description: 'Applied to invoices when GST is enabled on a client.' },
  // ── Branding ─────────────────────────────────────────────────────────────
  company_logo_url:          { value: '',                               label: 'Company Logo URL',          group: 'Branding',         type: 'string',  description: 'Public URL of the company logo used in emails and PDFs.' },
  favicon_url:               { value: '',                               label: 'Favicon URL',               group: 'Branding',         type: 'string',  description: 'Public URL of the favicon for the web portal.' },
  brand_primary_color:       { value: '#2952e3',                        label: 'Primary Brand Colour',      group: 'Branding',         type: 'string',  description: 'Hex colour used in email templates and PDF headers.' },
  // ── Invoice ───────────────────────────────────────────────────────────────
  invoice_prefix:            { value: 'INV',                            label: 'Invoice Number Prefix',     group: 'Invoice',          type: 'string',  description: 'Prefix used when generating invoice numbers.' },
  receipt_prefix:            { value: 'RCP',                            label: 'Receipt Number Prefix',     group: 'Invoice',          type: 'string',  description: 'Prefix for payment receipt numbers.' },
  invoice_starting_number:   { value: 1000,                             label: 'Invoice Starting Number',   group: 'Invoice',          type: 'number',  description: 'Serial number from which new invoices are numbered.' },
  invoice_footer:            { value: 'Thank you for your business.',   label: 'Invoice Footer Text',       group: 'Invoice',          type: 'string',  description: 'Shown at the bottom of every invoice.' },
  // ── Password Policy ───────────────────────────────────────────────────────
  password_min_length:       { value: 8,                                label: 'Minimum Password Length',   group: 'Password Policy',  type: 'number',  description: 'Enforced on all password set/change operations.' },
  password_require_uppercase: { value: true,                            label: 'Require Uppercase Letter',  group: 'Password Policy',  type: 'boolean', description: 'Password must contain at least one uppercase letter.' },
  password_require_lowercase: { value: true,                            label: 'Require Lowercase Letter',  group: 'Password Policy',  type: 'boolean', description: 'Password must contain at least one lowercase letter.' },
  password_require_numbers:  { value: true,                             label: 'Require Number',            group: 'Password Policy',  type: 'boolean', description: 'Password must contain at least one digit.' },
  password_require_special:  { value: false,                            label: 'Require Special Character', group: 'Password Policy',  type: 'boolean', description: 'Password must contain at least one special character.' },
  password_expiry_days:      { value: 0,                                label: 'Password Expiry (days)',    group: 'Password Policy',  type: 'number',  description: 'Days before password must be changed. 0 = never expires.' },
  account_lock_duration_minutes: { value: 30,                           label: 'Account Lock Duration (min)', group: 'Password Policy', type: 'number', description: 'Minutes an account stays locked after exceeding login attempts.' },
  // ── Security ──────────────────────────────────────────────────────────────
  session_timeout_hours:     { value: 24,                               label: 'Session Timeout (hours)',   group: 'Security',         type: 'number',  description: 'Access token expiry window.' },
  refresh_token_days:        { value: 7,                                label: 'Refresh Token TTL (days)',  group: 'Security',         type: 'number',  description: 'How long a refresh token stays valid.' },
  max_login_attempts:        { value: 5,                                label: 'Max Login Attempts',        group: 'Security',         type: 'number',  description: 'Account is locked after this many consecutive failures.' },
  otp_expiry_minutes:        { value: 10,                               label: 'OTP Expiry (minutes)',      group: 'Security',         type: 'number',  description: 'Time before a one-time password expires.' },
  // ── Upload Rules ──────────────────────────────────────────────────────────
  kyc_retention_days:        { value: 90,                               label: 'KYC Document Retention (days)', group: 'Upload Rules', type: 'number',  description: 'Days before KYC uploads are eligible for archival.' },
  kyc_max_file_size_mb:      { value: 10,                               label: 'KYC Max Upload Size (MB)',  group: 'Upload Rules',     type: 'number',  description: 'Maximum size for a single KYC document upload.' },
  kyc_accepted_formats:      { value: 'PDF,JPG,PNG',                    label: 'KYC Accepted File Formats', group: 'Upload Rules',     type: 'string',  description: 'Comma-separated list of allowed MIME sub-types for KYC.' },
  max_upload_size_mb:        { value: 20,                               label: 'Global Max Upload Size (MB)', group: 'Upload Rules',   type: 'number',  description: 'Maximum size for any non-KYC file upload.' },
  allowed_file_types:        { value: 'PDF,JPG,PNG,DOCX,XLSX',         label: 'Allowed File Types (global)', group: 'Upload Rules',   type: 'string',  description: 'Comma-separated list of allowed file types for general uploads.' },
  image_compression_enabled: { value: true,                             label: 'Image Compression',         group: 'Upload Rules',     type: 'boolean', description: 'Compress uploaded images server-side before storing.' },
  ocr_enabled:               { value: false,                            label: 'OCR Processing',            group: 'Upload Rules',     type: 'boolean', description: 'Run OCR on uploaded documents (requires OCR service).' },
  max_files_per_upload:      { value: 5,                                label: 'Max Files Per Upload',      group: 'Upload Rules',     type: 'number',  description: 'Maximum number of files allowed in a single upload batch.' },
  storage_provider:          { value: 'local',                          label: 'Storage Provider',          group: 'Upload Rules',     type: 'string',  description: 'Storage backend: local or s3.' },
  // ── Email ─────────────────────────────────────────────────────────────────
  email_from_name:           { value: 'LauncherDesk',                   label: 'Email From Name',           group: 'Email',            type: 'string',  description: 'Display name used in outgoing email From header.' },
  email_from_address:        { value: 'noreply@launcherdesk.com',       label: 'Email From Address',        group: 'Email',            type: 'string',  description: 'Reply-to address for all system emails.' },
  email_notifications_enabled: { value: true,                           label: 'Email Notifications',       group: 'Email',            type: 'boolean', description: 'Enable or disable all outbound email notifications.' },
  // ── Notifications ─────────────────────────────────────────────────────────
  notification_poll_interval_seconds: { value: 45,                      label: 'Notification Poll Interval (sec)', group: 'Notifications', type: 'number', description: 'How often the frontend polls for new notifications when SSE is unavailable.' },
  notification_retention_days: { value: 90,                             label: 'Notification Retention (days)', group: 'Notifications', type: 'number', description: 'Days before read notifications are eligible for cleanup.' },
  // ── Feature Flags ─────────────────────────────────────────────────────────
  client_self_registration:  { value: false,                            label: 'Client Self-Registration',  group: 'Feature Flags',    type: 'boolean', description: 'Allow clients to self-register without admin invitation.' },
  public_api_enabled:        { value: false,                            label: 'Public API Access',         group: 'Feature Flags',    type: 'boolean', description: 'Enable public API endpoints (requires API key management).' },
  workflow_auto_tasks:       { value: true,                             label: 'Automatic Task Creation',   group: 'Feature Flags',    type: 'boolean', description: 'Automatically create tasks when an order is placed.' },
  kyc_required:              { value: true,                             label: 'KYC Required for Orders',   group: 'Feature Flags',    type: 'boolean', description: 'Block order progress until KYC is verified.' },
  // ── System ────────────────────────────────────────────────────────────────
  maintenance_mode:          { value: false,                            label: 'Maintenance Mode',          group: 'System',           type: 'boolean', description: 'When enabled, only Super Admins can access the platform.' },
  audit_retention_days:      { value: 365,                              label: 'Audit Log Retention (days)', group: 'System',          type: 'number',  description: 'Days before audit records are eligible for archival.' },
  storage_limit_gb:          { value: 10,                               label: 'Storage Limit (GB)',        group: 'System',           type: 'number',  description: 'Maximum total upload storage across all clients.' },
  auto_backup_enabled:       { value: false,                            label: 'Auto Backup',               group: 'System',           type: 'boolean', description: 'Enable scheduled automatic data backups (requires backup daemon).' },
  auto_backup_interval_hours: { value: 24,                              label: 'Auto Backup Interval (hours)', group: 'System',        type: 'number',  description: 'How often automatic backups run.' },
};

async function getSettings() {
  const stored = await SystemSetting.find({}).lean();
  const storedMap = {};
  for (const s of stored) {
    storedMap[s.key] = s;
  }

  const result = {};
  for (const [key, meta] of Object.entries(DEFAULTS)) {
    result[key] = {
      key,
      label: meta.label,
      group: meta.group,
      type: meta.type,
      description: meta.description,
      value: storedMap[key] !== undefined ? storedMap[key].value : meta.default ?? meta.value,
      isDefault: storedMap[key] === undefined,
      updatedAt: storedMap[key]?.updatedAt ?? null,
    };
  }
  return result;
}

async function updateSetting(key, value, actor) {
  if (!DEFAULTS[key]) {
    const AppError = require('../../utils/portal/AppError');
    throw AppError.badRequest(`Unknown setting key: ${key}`);
  }

  const meta = DEFAULTS[key];

  // Type coercion and validation
  let coerced = value;
  if (meta.type === 'number') {
    coerced = Number(value);
    if (isNaN(coerced)) {
      const AppError = require('../../utils/portal/AppError');
      throw AppError.badRequest(`${meta.label} must be a number.`);
    }
  } else if (meta.type === 'boolean') {
    coerced = value === true || value === 'true' || value === 1;
  } else {
    coerced = String(value ?? '').trim();
    if (!coerced && value !== 0) {
      const AppError = require('../../utils/portal/AppError');
      throw AppError.badRequest(`${meta.label} cannot be blank.`);
    }
  }

  const before = await SystemSetting.findOne({ key }).lean();

  await SystemSetting.findOneAndUpdate(
    { key },
    { $set: { value: coerced, description: meta.description, updatedBy: actor?._id ?? null } },
    { upsert: true, new: true }
  );

  await logAudit({
    actor: actor?._id ?? null,
    actorRole: actor?.role ?? 'SYSTEM',
    action: AUDIT_ACTIONS.SETTING_UPDATED,
    resourceType: 'SystemSetting',
    resourceId: null,
    metadata: { key, label: meta.label, before: before?.value ?? meta.value, after: coerced },
  });

  return { key, value: coerced };
}

/**
 * Read a single setting value, falling back to the in-process default.
 * Use this from other services to avoid loading all 50+ settings every time.
 */
async function getSettingValue(key) {
  const meta = DEFAULTS[key];
  if (!meta) return undefined;
  const stored = await SystemSetting.findOne({ key }).lean();
  return stored !== null ? stored.value : meta.value;
}

/**
 * Validate a plaintext password against the current policy settings.
 * Returns an array of error strings; empty array = valid.
 */
async function validatePasswordPolicy(plaintext) {
  const errors = [];
  const minLen = await getSettingValue('password_min_length');
  const requireUpper = await getSettingValue('password_require_uppercase');
  const requireLower = await getSettingValue('password_require_lowercase');
  const requireNumbers = await getSettingValue('password_require_numbers');
  const requireSpecial = await getSettingValue('password_require_special');

  if (plaintext.length < (minLen || 8)) {
    errors.push(`Password must be at least ${minLen || 8} characters.`);
  }
  if (requireUpper && !/[A-Z]/.test(plaintext)) {
    errors.push('Password must contain at least one uppercase letter.');
  }
  if (requireLower && !/[a-z]/.test(plaintext)) {
    errors.push('Password must contain at least one lowercase letter.');
  }
  if (requireNumbers && !/[0-9]/.test(plaintext)) {
    errors.push('Password must contain at least one number.');
  }
  if (requireSpecial && !/[^A-Za-z0-9]/.test(plaintext)) {
    errors.push('Password must contain at least one special character.');
  }
  return errors;
}

module.exports = { getSettings, updateSetting, getSettingValue, validatePasswordPolicy, DEFAULTS };
