# LauncherDesk — Phase 1 Notification Engine

## How it fits together
```
App code → services/events.emit(EVENT) → services/notification/engine.notify()
        → Notification row (QUEUED, unique idempotency key) → provider (Brevo/SendGrid/Resend/Mailgun) → customer
                                  ↘ EventLog (audit trail)
```
Never send customer emails directly from a controller — call `events.emit()` (or `orderService.changeStatus()`).

## Files
| Area | File |
|---|---|
| Event → template map | `src/services/events.js` |
| Engine (idempotency, retries, resend) | `src/services/notification/engine.js` |
| Providers (switch with `EMAIL_PROVIDER`) | `src/services/notification/providers.js` |
| 28 built-in templates | `src/services/notification/defaultTemplates.js` |
| Variables (`{{order_id}}` …) | `src/services/notification/variables.js` |
| Branded layout | `src/services/notification/layout.js` |
| Order IDs + status engine + document requests | `src/services/orderService.js` |
| Payment success/failure/refund (verify + webhook) | `src/services/paymentService.js` |
| Tax invoice + PDF | `src/services/invoiceService.js` |
| Email OTP | `src/services/otpService.js` |
| Reminders, retries, feedback jobs | `src/services/scheduler.js` |
| Documents needed per service | `src/data/serviceDocuments.js` |
| Customer API | `src/routes/customerOps.js` (mounted at `/api/user`) |
| Admin API | `src/routes/adminOps.js` (mounted at `/api/admin/ops`) |

## Key rules implemented
- **Duplicate protection:** unique `idempotencyKey` = order + event + template (+ payment ID / document ID / status-entry number). Razorpay webhooks are also de-duplicated by `x-razorpay-event-id`. Payment success runs once via an atomic update, whether the browser verify or the webhook arrives first.
- **Retries:** attempt 1 now, 2 after 5 min, 3 after 30 min (admin-configurable). Then `FAILED` + `EMAIL_FAILED` event, visible in `/api/admin/ops/notifications?status=FAILED`.
- **Invoice** is created only after a confirmed payment, one per payment.
- **OTP** stored as an HMAC hash, one active code per user, expiry/cooldown/hourly cap/attempt limit from settings. OTP emails are never stored in readable form or resent.
- **Documents** stored outside `/uploads`, downloaded only through authenticated routes.
- **Status emails** are per-status toggles in settings (`statusEmailEnabled`); internal notes are never emailed.
- **Order-created email** is delayed (default 30 min) and skipped automatically if the customer pays first.

## Endpoints
Customer (Bearer token):
- `POST /api/auth/otp/send`, `POST /api/auth/otp/verify { otp }`
- `GET /api/user/orders/:id/documents`, `POST /api/user/orders/:id/documents/:docId/upload` (field `file`), `POST /api/user/orders/:id/documents/submit`, `GET /api/user/orders/:id/documents/:docId/download`
- `GET /api/user/orders/:id/timeline`, `GET /api/user/invoices`, `GET /api/user/invoices/:id/pdf`
- `POST /api/user/tickets`, `GET /api/user/tickets`, `GET /api/user/tickets/:ticketId`, `POST /api/user/tickets/:ticketId/messages`

Razorpay: `POST /api/payments/webhook`

Admin: see the header comment in `src/routes/adminOps.js` (orders, status, assign, action-required, document review, final documents, cancel, refund, communication history, events, notifications, resend, templates, settings, tickets).

## Setup
1. `npm install` (adds `pdfkit`).
2. Add the new variables from `env (1).example` to Railway.
3. Razorpay Dashboard → Settings → Webhooks → add `https://<your-api>/api/payments/webhook`, set the secret as `RAZORPAY_WEBHOOK_SECRET`, tick the six events listed in the env file.
4. Give the server a persistent volume for `PRIVATE_UPLOAD_DIR` (or customer documents are lost on redeploy).
