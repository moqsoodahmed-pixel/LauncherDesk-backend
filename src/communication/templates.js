const { COMMUNICATION_EVENT } = require('../constants/portal/communicationEvents');

/**
 * One entry per communication event. `channels` lists only the channels
 * that event actually sends on (never force every event onto every
 * channel - see Phase 9 spec §14). `allowedVariables` is the explicit
 * whitelist checked by communication.service.js before anything is
 * persisted/rendered - an unlisted variable is silently dropped, never
 * passed through, so a caller can never leak an unexpected field into a
 * template or a stored log.
 *
 * EMAIL carries real subject/html (rendered via renderTemplate.js).
 * WHATSAPP/SMS carry a `body` used only by the DevelopmentWhatsAppProvider's
 * readable log line and as a safe fallback description; the real MSG91
 * provider sends by registered template name/id (env-configured, see
 * adapters/whatsapp/MSG91Provider.js) with these same variables as ordered
 * template params - the literal `body` string is never what MSG91 actually
 * transmits in production (WhatsApp/SMS require pre-approved templates).
 */
const TEMPLATES = {
  [COMMUNICATION_EVENT.ORDER_CREATED]: {
    allowedVariables: ['clientName', 'orderNumber', 'serviceName', 'amount', 'currency', 'orderUrl'],
    channels: {
      email: {
        subject: 'Order {{orderNumber}} received - LauncherDesk',
        html: '<p>Hi {{clientName}},</p><p>We have received your order <strong>{{orderNumber}}</strong> for <strong>{{serviceName}}</strong> ({{currency}} {{amount}}).</p><p><a href="{{orderUrl}}">View your order</a></p>',
      },
      whatsapp: { body: 'Hi {{clientName}}, your order {{orderNumber}} for {{serviceName}} has been received. View: {{orderUrl}}' },
    },
  },

  [COMMUNICATION_EVENT.ORDER_PAYMENT_PENDING]: {
    allowedVariables: ['clientName', 'orderNumber', 'amount', 'currency', 'orderUrl'],
    channels: {
      email: {
        subject: 'Payment pending for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>Order <strong>{{orderNumber}}</strong> is awaiting payment of {{currency}} {{amount}}.</p><p><a href="{{orderUrl}}">Pay now</a></p>',
      },
    },
  },

  [COMMUNICATION_EVENT.ORDER_PAYMENT_CONFIRMED]: {
    // invoiceNumber/invoiceUrl satisfy Parts 4 and 5 of the transactional-email
    // brief (Payment Success + Invoice) at their single real trigger point -
    // the order's invoiceNumber already exists at order-creation time (see
    // idGenerator.service.js), and /client/orders/:id/invoice is the existing
    // print-to-PDF invoice page (InvoicePage.jsx -> window.print()). There is
    // no backend PDF-buffer generator for Portal invoices to attach a file
    // from, so this links to that same, already-existing page rather than
    // fabricating a second invoice/PDF pipeline.
    allowedVariables: ['clientName', 'orderNumber', 'amount', 'currency', 'paymentDate', 'orderUrl', 'invoiceNumber', 'invoiceUrl'],
    channels: {
      email: {
        subject: 'Payment confirmed for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>Thank you - we have received your payment of <strong>{{currency}} {{amount}}</strong> for order <strong>{{orderNumber}}</strong> on {{paymentDate}}.</p><p>Invoice number: <strong>{{invoiceNumber}}</strong></p><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px;"><a href="{{invoiceUrl}}" style="display:inline-block;padding:11px 20px;background:linear-gradient(135deg,#1D6FE0,#0F52C0);color:#fff;font-weight:700;font-size:13px;text-decoration:none;border-radius:8px;">Download Invoice</a></td><td><a href="{{orderUrl}}" style="display:inline-block;padding:11px 20px;background:#F1F5F9;color:#1D6FE0;font-weight:700;font-size:13px;text-decoration:none;border-radius:8px;border:1px solid #CBD5E1;">View Order</a></td></tr></table>',
      },
      whatsapp: { body: 'Hi {{clientName}}, payment of {{currency}} {{amount}} for order {{orderNumber}} is confirmed. View: {{orderUrl}}' },
      sms: { body: 'LauncherDesk: Payment confirmed for order {{orderNumber}}, amount {{currency}} {{amount}}.' },
    },
  },

  [COMMUNICATION_EVENT.ORDER_PAYMENT_FAILED]: {
    allowedVariables: ['clientName', 'orderNumber', 'orderUrl'],
    channels: {
      email: {
        subject: 'Payment attempt unsuccessful for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>Your recent payment attempt for order <strong>{{orderNumber}}</strong> was not successful. You can try again from your portal.</p><p><a href="{{orderUrl}}">Retry payment</a></p>',
      },
    },
  },

  [COMMUNICATION_EVENT.ORDER_ASSIGNED]: {
    allowedVariables: ['adminName', 'orderNumber', 'clientName', 'orderUrl'],
    channels: {
      // Internal notification only - never sent to the client (no
      // operational/assignment detail is client-facing per Phase 9 §39).
      email: {
        subject: 'Order {{orderNumber}} assigned to you',
        html: '<p>Hi {{adminName}},</p><p>Order <strong>{{orderNumber}}</strong> ({{clientName}}) has been assigned to you.</p><p><a href="{{orderUrl}}">View order</a></p>',
      },
    },
  },

  [COMMUNICATION_EVENT.ORDER_STATUS_CHANGED]: {
    allowedVariables: ['clientName', 'orderNumber', 'statusLabel', 'orderUrl'],
    channels: {
      email: {
        subject: 'Order {{orderNumber}} status update',
        html: '<p>Hi {{clientName}},</p><p>Order <strong>{{orderNumber}}</strong> is now <strong>{{statusLabel}}</strong>.</p><p><a href="{{orderUrl}}">View your order</a></p>',
      },
    },
  },

  [COMMUNICATION_EVENT.ORDER_CANCELLED]: {
    allowedVariables: ['clientName', 'orderNumber', 'orderUrl'],
    channels: {
      email: {
        subject: 'Order {{orderNumber}} cancelled',
        html: '<p>Hi {{clientName}},</p><p>Order <strong>{{orderNumber}}</strong> has been cancelled.</p><p><a href="{{orderUrl}}">View your order</a></p>',
      },
    },
  },

  [COMMUNICATION_EVENT.ORDER_COMPLETED]: {
    allowedVariables: ['clientName', 'orderNumber', 'serviceName', 'orderUrl'],
    channels: {
      email: {
        subject: 'Order {{orderNumber}} completed',
        html: '<p>Hi {{clientName}},</p><p>Your order <strong>{{orderNumber}}</strong> for {{serviceName}} is now complete.</p><p><a href="{{orderUrl}}">View your order</a></p>',
      },
      whatsapp: { body: 'Hi {{clientName}}, your order {{orderNumber}} is complete. View: {{orderUrl}}' },
    },
  },

  [COMMUNICATION_EVENT.ORDER_CLOSED]: {
    allowedVariables: ['clientName', 'orderNumber', 'orderUrl'],
    channels: {
      email: {
        subject: 'Order {{orderNumber}} closed',
        html: '<p>Hi {{clientName}},</p><p>Order <strong>{{orderNumber}}</strong> has been closed.</p><p><a href="{{orderUrl}}">View your order</a></p>',
      },
    },
  },

  [COMMUNICATION_EVENT.KYC_SUBMITTED]: {
    allowedVariables: ['clientName', 'orderNumber', 'orderUrl'],
    channels: {
      email: {
        subject: 'KYC documents submitted for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>We have received your KYC documents for order <strong>{{orderNumber}}</strong> and will review them shortly.</p><p><a href="{{orderUrl}}">View status</a></p>',
      },
    },
  },

  [COMMUNICATION_EVENT.KYC_REJECTED]: {
    allowedVariables: ['clientName', 'orderNumber', 'orderUrl'],
    channels: {
      email: {
        subject: 'Action required: KYC for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>Your KYC documents for order <strong>{{orderNumber}}</strong> require attention. Please log in to your LauncherDesk portal to review and re-upload.</p><p><a href="{{orderUrl}}">Go to portal</a></p>',
      },
      whatsapp: { body: 'Hi {{clientName}}, your KYC for order {{orderNumber}} needs attention. Please check your portal: {{orderUrl}}' },
    },
  },

  // Per-document rejection (immediate, before the order itself necessarily
  // reaches KYC_REJECTED - e.g. one of several required documents). Never
  // includes the document itself, only the type and a safe reason.
  [COMMUNICATION_EVENT.KYC_DOCUMENT_REJECTED]: {
    allowedVariables: ['clientName', 'orderNumber', 'documentType', 'rejectionReason', 'orderUrl'],
    channels: {
      email: {
        subject: 'Document update needed for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>Your {{documentType}} for order <strong>{{orderNumber}}</strong> could not be accepted: {{rejectionReason}}</p><p>Please log in to your portal to re-upload.</p><p><a href="{{orderUrl}}">Go to portal</a></p>',
      },
    },
  },

  // Wave 2 addition: the "please re-upload" sibling of KYC_DOCUMENT_REJECTED
  // (requestReupload sets NEED_REUPLOAD instead of REJECTED - a softer
  // outcome - but the client still needs to be told to act). Mirrors
  // KYC_DOCUMENT_REJECTED's shape/variables exactly.
  [COMMUNICATION_EVENT.KYC_DOCUMENT_NEED_REUPLOAD]: {
    allowedVariables: ['clientName', 'orderNumber', 'documentType', 'reason', 'orderUrl'],
    channels: {
      email: {
        subject: 'Please re-upload a document for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>Your {{documentType}} for order <strong>{{orderNumber}}</strong> needs to be re-uploaded: {{reason}}</p><p>Please log in to your portal to upload a new copy.</p><p><a href="{{orderUrl}}">Go to portal</a></p>',
      },
    },
  },

  [COMMUNICATION_EVENT.DOCUMENT_REQUESTED]: {
    allowedVariables: ['clientName', 'orderNumber', 'documentLabel', 'orderUrl'],
    channels: {
      email: {
        subject: 'Document requested for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>We need an additional document for order <strong>{{orderNumber}}</strong>: {{documentLabel}}</p><p>Please log in to your portal to upload it.</p><p><a href="{{orderUrl}}">Go to portal</a></p>',
      },
    },
  },

  [COMMUNICATION_EVENT.DOCUMENT_FULFILLED]: {
    allowedVariables: ['clientName', 'orderNumber', 'documentLabel', 'orderUrl'],
    channels: {
      email: {
        subject: 'Document received for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>Thank you - we have received your {{documentLabel}} for order <strong>{{orderNumber}}</strong>.</p><p><a href="{{orderUrl}}">View your order</a></p>',
      },
    },
  },

  [COMMUNICATION_EVENT.KYC_VERIFIED]: {
    allowedVariables: ['clientName', 'orderNumber', 'orderUrl'],
    channels: {
      email: {
        subject: 'KYC verified for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>Your KYC documents for order <strong>{{orderNumber}}</strong> have been verified. Work on your order is now in progress.</p><p><a href="{{orderUrl}}">View your order</a></p>',
      },
      whatsapp: { body: 'Hi {{clientName}}, your KYC for order {{orderNumber}} is verified and your order is now in progress. View: {{orderUrl}}' },
    },
  },

  [COMMUNICATION_EVENT.PAYMENT_REFUNDED]: {
    allowedVariables: ['clientName', 'orderNumber', 'amount', 'currency', 'orderUrl'],
    channels: {
      email: {
        subject: 'Refund processed for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>A refund of {{currency}} {{amount}} has been processed for order <strong>{{orderNumber}}</strong>.</p><p><a href="{{orderUrl}}">View your order</a></p>',
      },
    },
  },

  // Deliberately excludes any password or generated credential - the client
  // sets their own password at signup; there is nothing secret to send.
  [COMMUNICATION_EVENT.CLIENT_WELCOME]: {
    allowedVariables: ['clientName', 'clientCode', 'email', 'registeredDate', 'status', 'loginUrl'],
    channels: {
      email: {
        subject: 'Welcome to LauncherDesk',
        html:
          '<p>Hi {{clientName}},</p>' +
          '<p>Welcome to LauncherDesk - your account has been created successfully.</p>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;font-size:13px;">' +
          '<tr><td style="padding:4px 0;color:#64748B;">Client ID</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{clientCode}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Registered Email</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{email}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Registration Date</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{registeredDate}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Account Status</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{status}}</td></tr>' +
          '</table>' +
          '<a href="{{loginUrl}}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#1D6FE0,#0F52C0);color:#fff;font-weight:700;font-size:13.5px;text-decoration:none;border-radius:8px;">Log In to LauncherDesk</a>',
      },
    },
  },

  // No password is ever included: this system does not auto-generate one -
  // the Super Admin sets the new Admin's password directly at creation
  // time (see admins.validators.js), so there is nothing to safely email.
  [COMMUNICATION_EVENT.ADMIN_CREATED]: {
    allowedVariables: ['adminName', 'adminCode', 'email', 'role', 'loginUrl'],
    channels: {
      email: {
        subject: 'Your LauncherDesk Admin account has been created',
        html:
          '<p>Hi {{adminName}},</p>' +
          '<p>A LauncherDesk Portal account has been created for you.</p>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;font-size:13px;">' +
          '<tr><td style="padding:4px 0;color:#64748B;">Admin ID</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{adminCode}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Email</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{email}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Role</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{role}}</td></tr>' +
          '</table>' +
          '<p>Use the password provided to you separately by your Super Admin to sign in. <strong>You should change your password immediately after your first login.</strong></p>' +
          '<a href="{{loginUrl}}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#1D6FE0,#0F52C0);color:#fff;font-weight:700;font-size:13.5px;text-decoration:none;border-radius:8px;">Go to Portal Login</a>',
      },
    },
  },

  [COMMUNICATION_EVENT.CLIENT_ASSIGNED_ADMIN]: {
    allowedVariables: ['clientName', 'adminName', 'adminEmail'],
    channels: {
      email: {
        subject: 'You have been assigned an Account Manager',
        html:
          '<p>Hi {{clientName}},</p>' +
          '<p>You have been assigned an Account Manager who will be your point of contact for your orders.</p>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;font-size:13px;">' +
          '<tr><td style="padding:4px 0;color:#64748B;">Account Manager</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{adminName}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Email</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{adminEmail}}</td></tr>' +
          '</table>',
      },
    },
  },

  // Sent once per Invoice record, with the generated PDF attached via
  // dispatchCommunicationEvent's attachmentStorageKey/attachmentFileName
  // (see invoice.service.js) - the attachment itself is never a template
  // variable, it travels alongside the CommunicationLog record.
  [COMMUNICATION_EVENT.INVOICE_GENERATED]: {
    allowedVariables: ['customerName', 'orderCode', 'invoiceNumber', 'amountPaid', 'currency', 'paymentStatus', 'invoiceUrl'],
    channels: {
      email: {
        subject: 'LauncherDesk Invoice - {{invoiceNumber}}',
        html:
          '<p>Hi {{customerName}},</p>' +
          '<p>Thank you for your payment. Your tax invoice is attached to this email as a PDF.</p>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;font-size:13px;">' +
          '<tr><td style="padding:4px 0;color:#64748B;">Order ID</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{orderCode}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Invoice Number</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{invoiceNumber}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Amount Paid</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{currency}} {{amountPaid}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Payment Status</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{paymentStatus}}</td></tr>' +
          '</table>' +
          '<a href="{{invoiceUrl}}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#1D6FE0,#0F52C0);color:#fff;font-weight:700;font-size:13.5px;text-decoration:none;border-radius:8px;">Download Invoice</a>' +
          '<p style="margin-top:18px;">Thank you for choosing LauncherDesk.</p>',
      },
    },
  },

  [COMMUNICATION_EVENT.ADMIN_CLIENT_ASSIGNED]: {
    allowedVariables: ['adminName', 'clientName', 'clientCode', 'clientEmail', 'clientPhone', 'companyName', 'assignedDate', 'clientUrl'],
    channels: {
      email: {
        subject: 'New client assigned to you',
        html:
          '<p>Hi {{adminName}},</p>' +
          '<p>A new client has been assigned to you.</p>' +
          '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;font-size:13px;">' +
          '<tr><td style="padding:4px 0;color:#64748B;">Client Name</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{clientName}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Client ID</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{clientCode}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Email</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{clientEmail}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Phone</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{clientPhone}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Company</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{companyName}}</td></tr>' +
          '<tr><td style="padding:4px 0;color:#64748B;">Assigned On</td><td style="padding:4px 0;text-align:right;font-weight:700;">{{assignedDate}}</td></tr>' +
          '</table>' +
          '<a href="{{clientUrl}}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#1D6FE0,#0F52C0);color:#fff;font-weight:700;font-size:13.5px;text-decoration:none;border-radius:8px;">Open Client</a>',
      },
    },
  },
};

function getTemplate(eventType) {
  return TEMPLATES[eventType] || null;
}

/** Drops any variable not on the event's explicit allowlist. */
function sanitizeVariables(eventType, variables = {}) {
  const template = getTemplate(eventType);
  if (!template) return {};
  const clean = {};
  for (const key of template.allowedVariables) {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      clean[key] = variables[key];
    }
  }
  return clean;
}

module.exports = { TEMPLATES, getTemplate, sanitizeVariables };
