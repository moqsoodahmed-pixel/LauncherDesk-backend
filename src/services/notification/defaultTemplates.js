/**
 * Built-in email templates. Admins can override subject/body per template
 * (EmailTemplate collection); anything not overridden uses these defaults.
 * One template works for every service — service details come from variables.
 *
 * heading/body/subject use {{variables}} (see variables.js for the full list).
 * cta.urlVar names the variable holding the button link — always a specific
 * dashboard page, never the homepage.
 */
const T = (id, name, event, subject, heading, body, cta, opts = {}) =>
  ({ templateId: id, name, triggerEvent: event, subject, heading, body, cta, isSystem: !!opts.system })

const orderBox = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;margin:14px 0">
<tr><td style="padding:14px 16px;font-size:14px;line-height:1.8;color:#334155">
<strong>Order ID:</strong> {{order_id}}<br><strong>Service:</strong> {{service_name}}<br><strong>Status:</strong> {{order_status}}
</td></tr></table>`

const TEMPLATES = [
  T('AUTH_EMAIL_OTP', 'Email OTP', 'CUSTOMER_REGISTERED',
    'Your LauncherDesk verification code: {{otp}}',
    'Verify your email address',
    `<p>Hi {{customer_name}},</p><p>Use this code to verify your LauncherDesk account:</p>
<p style="font-size:30px;font-weight:bold;letter-spacing:8px;color:#0A2540;margin:18px 0">{{otp}}</p>
<p>The code expires in <strong>{{otp_expiry_minutes}} minutes</strong>. Never share it with anyone — LauncherDesk will never ask for it.</p>
<p style="color:#64748B;font-size:13px">If you didn't create a LauncherDesk account, you can ignore this email.</p>`,
    { label: 'Verify Email', urlVar: 'verification_url' }, { system: true }),

  T('AUTH_WELCOME', 'Welcome', 'EMAIL_VERIFIED',
    'Welcome to LauncherDesk, {{customer_name}}!',
    'Your account is ready',
    `<p>Hi {{customer_name}},</p><p>Your email is verified and your LauncherDesk account is active.</p>
<p>From your dashboard you can track every order, upload documents, download invoices and talk to our team — all in one place.</p>
<p>Need help? Reply to this email or visit <a href="{{support_url}}">LauncherDesk Support</a>.</p>`,
    { label: 'Go to Dashboard', urlVar: 'dashboard_url' }),

  T('ORDER_CREATED', 'Order Created', 'ORDER_CREATED',
    'Order {{order_id}} created — {{service_name}}',
    'Your order has been created',
    `<p>Hi {{customer_name}},</p><p>We've created your order for <strong>{{service_name}}</strong>.</p>${orderBox}
<p><strong>Amount:</strong> {{total_amount}}</p><p>Your payment is still pending. Complete it to get started — our team begins work as soon as payment is confirmed.</p>`,
    { label: 'Complete Payment', urlVar: 'order_url' }),

  T('PAYMENT_SUCCESS', 'Payment Successful', 'PAYMENT_SUCCESSFUL',
    'Payment received — {{service_name}} ({{order_id}})',
    'Payment successful',
    `<p>Hi {{customer_name}},</p><p>We've received your payment. Thank you!</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;margin:14px 0"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.8;color:#166534">
<strong>Order ID:</strong> {{order_id}}<br><strong>Service:</strong> {{service_name}}<br><strong>Payment ID:</strong> {{payment_id}}<br><strong>Amount:</strong> {{payment_amount}}<br><strong>Date:</strong> {{payment_date}}
</td></tr></table>
<p><strong>Next steps:</strong> your tax invoice follows in a separate email, and we'll send you the list of documents we need to begin.</p>`,
    { label: 'View Order', urlVar: 'order_url' }, { system: true }),

  T('PAYMENT_FAILED', 'Payment Failed', 'PAYMENT_FAILED',
    'Payment unsuccessful — {{service_name}} ({{order_id}})',
    "Your payment didn't go through",
    `<p>Hi {{customer_name}},</p><p>Your payment of <strong>{{payment_amount}}</strong> for <strong>{{service_name}}</strong> was not successful. No money has been taken — if any amount was debited, your bank usually reverses it automatically.</p>${orderBox}<p>You can try again from your order page.</p>`,
    { label: 'Retry Payment', urlVar: 'order_url' }),

  T('PAYMENT_PENDING', 'Payment Pending', 'PAYMENT_PENDING',
    'Complete your payment — {{service_name}}',
    'Your payment is pending',
    `<p>Hi {{customer_name}},</p><p>Your order for <strong>{{service_name}}</strong> is waiting for payment of <strong>{{total_amount}}</strong>.</p>${orderBox}`,
    { label: 'Complete Payment', urlVar: 'order_url' }),

  T('INVOICE_GENERATED', 'Tax Invoice', 'INVOICE_GENERATED',
    'Tax invoice {{invoice_number}} — {{service_name}}',
    'Your tax invoice',
    `<p>Hi {{customer_name}},</p><p>Here's the tax invoice for your payment.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;margin:14px 0"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.8;color:#334155">
<strong>Invoice No:</strong> {{invoice_number}}<br><strong>Invoice Date:</strong> {{invoice_date}}<br><strong>Service:</strong> {{service_name}}<br>
<strong>Taxable Amount:</strong> {{taxable_amount}}<br><strong>GST:</strong> {{gst_amount}}<br><strong>Total:</strong> {{total_amount}}<br><strong>Payment Ref:</strong> {{payment_id}}
</td></tr></table><p>You can download it any time from your dashboard (login required).</p>`,
    { label: 'Download Invoice', urlVar: 'invoice_url' }, { system: true }),

  T('DOCUMENTS_REQUIRED', 'Documents Required', 'DOCUMENTS_REQUIRED',
    'Documents needed to start {{service_name}} ({{order_id}})',
    'Please upload your documents',
    `<p>Hi {{customer_name}},</p><p>To start work on <strong>{{service_name}}</strong>, we need the following documents:</p>${orderBox}
<p><strong>Pending:</strong></p>{{{documents_pending_html}}}<p><strong>Already submitted:</strong></p>{{{documents_submitted_html}}}`,
    { label: 'Upload Documents', urlVar: 'document_upload_url' }),

  T('DOCUMENTS_RECEIVED', 'Documents Received', 'DOCUMENTS_SUBMITTED',
    'We received your documents — {{order_id}}',
    'Documents received',
    `<p>Hi {{customer_name}},</p><p>Thanks — we've received <strong>{{documents_submitted_count}}</strong> document(s) for <strong>{{service_name}}</strong>.</p>${orderBox}
<p><strong>Still pending:</strong></p>{{{documents_pending_html}}}`,
    { label: 'View Documents', urlVar: 'document_upload_url' }),

  T('DOCUMENTS_REVIEW', 'Documents Under Review', 'DOCUMENT_REVIEW_STARTED',
    'Your documents are under review — {{order_id}}',
    'Your documents are being reviewed',
    `<p>Hi {{customer_name}},</p><p>Our team is reviewing the documents you submitted for <strong>{{service_name}}</strong>. We'll let you know if anything needs to change.</p>${orderBox}`,
    { label: 'View Order', urlVar: 'order_url' }),

  T('DOCUMENT_CORRECTION', 'Document Correction Required', 'DOCUMENT_CORRECTION_REQUIRED',
    'Action needed: please re-upload {{document_name}} — {{order_id}}',
    'A document needs to be updated',
    `<p>Hi {{customer_name}},</p><p>Your <strong>{{document_name}}</strong> needs an update before we can continue.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;margin:14px 0"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.8;color:#9A3412">
<strong>Reason:</strong> {{rejection_reason}}<br><strong>What to do:</strong> {{required_correction}}
</td></tr></table>${orderBox}`,
    { label: 'Upload Replacement', urlVar: 'document_upload_url' }),

  T('DOCUMENT_REMINDER_1', 'Document Reminder 1', 'DOCUMENT_REMINDER_1',
    'Reminder: documents pending for {{service_name}} ({{order_id}})',
    'A quick reminder about your documents',
    `<p>Hi {{customer_name}},</p><p>We're still waiting for a few documents to start your <strong>{{service_name}}</strong>:</p>{{{documents_pending_html}}}${orderBox}`,
    { label: 'Upload Documents', urlVar: 'document_upload_url' }),

  T('DOCUMENT_REMINDER_2', 'Document Reminder 2', 'DOCUMENT_REMINDER_2',
    'Second reminder: documents pending — {{order_id}}',
    'Your order is waiting on documents',
    `<p>Hi {{customer_name}},</p><p>Your <strong>{{service_name}}</strong> order can't move forward until we receive:</p>{{{documents_pending_html}}}<p>It only takes a few minutes to upload them from your dashboard.</p>${orderBox}`,
    { label: 'Upload Documents', urlVar: 'document_upload_url' }),

  T('DOCUMENT_REMINDER_3', 'Final Document Reminder', 'DOCUMENT_REMINDER_3',
    'Final reminder: upload documents to avoid your order being put on hold — {{order_id}}',
    'Final reminder',
    `<p>Hi {{customer_name}},</p><p>This is our final reminder. If we don't receive the documents below soon, your <strong>{{service_name}}</strong> order will be put on hold.</p>{{{documents_pending_html}}}${orderBox}`,
    { label: 'Upload Documents Now', urlVar: 'document_upload_url' }),

  T('ORDER_ON_HOLD', 'Order On Hold', 'ORDER_ON_HOLD',
    'Your order {{order_id}} is on hold',
    'Your order is on hold',
    `<p>Hi {{customer_name}},</p><p>We've put your <strong>{{service_name}}</strong> order on hold.</p><p><strong>Reason:</strong> {{hold_reason}}</p>
<p><strong>What's pending:</strong></p>{{{documents_pending_html}}}<p>Complete the pending items and we'll resume immediately. Questions? Contact us at {{support_email}}.</p>${orderBox}`,
    { label: 'Resume Order', urlVar: 'order_url' }),

  T('ORDER_ASSIGNED', 'Order Assigned', 'ORDER_ASSIGNED',
    'Your order {{order_id}} has been assigned',
    'A specialist has been assigned to your order',
    `<p>Hi {{customer_name}},</p><p>Your <strong>{{service_name}}</strong> order has been assigned to {{assigned_executive}}.</p>${orderBox}<p><strong>Next step:</strong> {{next_step}}</p>`,
    { label: 'View Order', urlVar: 'order_url' }),

  T('PROCESSING_STARTED', 'Processing Started', 'PROCESSING_STARTED',
    'We have started working on {{service_name}} ({{order_id}})',
    'Your order is being processed',
    `<p>Hi {{customer_name}},</p><p>Your LauncherDesk service request is now being processed by our team.</p>${orderBox}<p><strong>Current stage:</strong> {{current_stage}}</p>`,
    { label: 'Track Order', urlVar: 'order_url' }),

  T('STATUS_UPDATE', 'Order Status Update', 'STATUS_UPDATE',
    'Update on your order {{order_id}}: {{order_status}}',
    'Your order status has been updated',
    `<p>Hi {{customer_name}},</p><p>{{status_message}}</p>${orderBox}`,
    { label: 'Track Order', urlVar: 'order_url' }),

  T('ACTION_REQUIRED', 'Customer Action Required', 'ACTION_REQUIRED',
    'Action required on your order {{order_id}}',
    'We need something from you',
    `<p>Hi {{customer_name}},</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;margin:14px 0"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.8;color:#7C2D12">
<strong>1. What's needed:</strong> {{action_required}}<br><strong>2. Why:</strong> {{action_reason}}<br><strong>3. What to do:</strong> {{action_steps}}<br><strong>4. Deadline:</strong> {{action_deadline}}
</td></tr></table>${orderBox}`,
    { label: 'Take Action', urlVar: 'action_url' }),

  T('ORDER_COMPLETED', 'Order Completed', 'ORDER_COMPLETED',
    'Your {{service_name}} is complete ({{order_id}})',
    'Your order is complete 🎉',
    `<p>Hi {{customer_name}},</p><p>Great news — your <strong>{{service_name}}</strong> was completed on <strong>{{completion_date}}</strong>.</p>${orderBox}<p>Your final documents are available securely in your dashboard.</p>`,
    { label: 'View Completed Order', urlVar: 'order_url' }),

  T('DOCUMENTS_READY', 'Final Documents Ready', 'DOCUMENTS_READY',
    'Your final documents are ready — {{order_id}}',
    'Your documents are ready to download',
    `<p>Hi {{customer_name}},</p><p>The final documents for <strong>{{service_name}}</strong> are ready:</p>{{{final_documents_html}}}
<p>For your security, documents can only be downloaded after you log in to your dashboard.</p>${orderBox}`,
    { label: 'Download Documents', urlVar: 'documents_url' }),

  T('FEEDBACK_REQUEST', 'Feedback / Thank You', 'FEEDBACK_REQUEST',
    'How did we do with your {{service_name}}?',
    'Thank you for choosing LauncherDesk',
    `<p>Hi {{customer_name}},</p><p>Thank you for trusting LauncherDesk with your <strong>{{service_name}}</strong>. We'd love to hear how it went — it takes less than a minute.</p><p>Need anything else? We're here at {{support_email}}.</p>`,
    { label: 'Share Feedback', urlVar: 'feedback_url' }),

  T('SUPPORT_CREATED', 'Support Ticket Created', 'SUPPORT_CREATED',
    '[{{ticket_id}}] We received your request',
    'Support ticket created',
    `<p>Hi {{customer_name}},</p><p>We've received your request and our team will get back to you shortly.</p><p><strong>Ticket ID:</strong> {{ticket_id}}<br><strong>Subject:</strong> {{ticket_subject}}</p>`,
    { label: 'View Ticket', urlVar: 'ticket_url' }),

  T('SUPPORT_UPDATED', 'Support Ticket Updated', 'SUPPORT_UPDATED',
    '[{{ticket_id}}] New reply on your support ticket',
    'Your support ticket has been updated',
    `<p>Hi {{customer_name}},</p><p>There's a new update on your ticket.</p><p><strong>Ticket ID:</strong> {{ticket_id}}<br><strong>Subject:</strong> {{ticket_subject}}</p><p>{{ticket_message}}</p>`,
    { label: 'View Ticket', urlVar: 'ticket_url' }),

  T('SUPPORT_RESOLVED', 'Support Ticket Resolved', 'SUPPORT_RESOLVED',
    '[{{ticket_id}}] Your support ticket has been resolved',
    'Your ticket is resolved',
    `<p>Hi {{customer_name}},</p><p>We've marked your ticket as resolved. If you still need help, just reply on the ticket and we'll reopen it.</p><p><strong>Ticket ID:</strong> {{ticket_id}}<br><strong>Subject:</strong> {{ticket_subject}}</p>`,
    { label: 'View Ticket', urlVar: 'ticket_url' }),

  T('ORDER_CANCELLED', 'Order Cancelled', 'ORDER_CANCELLED',
    'Your order {{order_id}} has been cancelled',
    'Order cancelled',
    `<p>Hi {{customer_name}},</p><p>Your order for <strong>{{service_name}}</strong> has been cancelled.</p><p><strong>Reason:</strong> {{cancellation_reason}}</p>${orderBox}<p>If a refund applies, we'll email you as soon as it's initiated.</p>`,
    { label: 'View Order', urlVar: 'order_url' }),

  T('REFUND_INITIATED', 'Refund Initiated', 'REFUND_INITIATED',
    'Refund initiated for order {{order_id}}',
    'Your refund has been initiated',
    `<p>Hi {{customer_name}},</p><p>We've initiated a refund of <strong>{{refund_amount}}</strong> for your <strong>{{service_name}}</strong> order.</p><p><strong>Refund ID:</strong> {{refund_id}}</p><p>Refunds usually reach your original payment method within 5–7 working days, depending on your bank.</p>${orderBox}`,
    { label: 'View Order', urlVar: 'order_url' }, { system: true }),

  T('REFUND_COMPLETED', 'Refund Completed', 'REFUND_COMPLETED',
    'Refund completed for order {{order_id}}',
    'Your refund is complete',
    `<p>Hi {{customer_name}},</p><p>Your refund of <strong>{{refund_amount}}</strong> has been processed by our payment partner.</p><p><strong>Refund ID:</strong> {{refund_id}}</p><p>It may take a few days to appear in your account depending on your bank.</p>${orderBox}`,
    { label: 'View Order', urlVar: 'order_url' }, { system: true }),
]

const BY_ID = Object.fromEntries(TEMPLATES.map(t => [t.templateId, t]))

module.exports = { TEMPLATES, BY_ID }
