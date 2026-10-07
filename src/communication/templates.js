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
    allowedVariables: ['clientName', 'orderNumber', 'amount', 'currency', 'paymentDate', 'orderUrl'],
    channels: {
      email: {
        subject: 'Payment confirmed for order {{orderNumber}}',
        html: '<p>Hi {{clientName}},</p><p>We have received your payment of {{currency}} {{amount}} for order <strong>{{orderNumber}}</strong> on {{paymentDate}}.</p><p><a href="{{orderUrl}}">View your order</a></p>',
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
