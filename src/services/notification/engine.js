/**
 * LauncherDesk Notification Engine
 *
 *   Application → events.emit() → notify() → Notification row (QUEUED) → provider → customer
 *
 * - Idempotent: every notification has a unique idempotencyKey; a duplicate
 *   key is silently ignored, so duplicate webhooks / retries / double status
 *   updates never send the same email twice.
 * - Retries: attempt 1 immediately, attempt 2 after 5 min, attempt 3 after
 *   30 min (configurable). After the last failure the row is FAILED and an
 *   EMAIL_FAILED event is logged for admins.
 * - Templates are rendered at send time from the database (variables.js),
 *   so delayed emails always show current data.
 * - `channel` is stored on every row so SMS / WhatsApp can be added later as
 *   additional senders without changing callers.
 */
const Notification = require('../../models/Notification')
const EmailTemplate = require('../../models/EmailTemplate')
const NotificationSetting = require('../../models/NotificationSetting')
const ServiceOrder = require('../../models/ServiceOrder')
const EventLog = require('../../models/EventLog')
const { BY_ID } = require('./defaultTemplates')
const { buildVariables } = require('./variables')
const { renderString, stripHtml } = require('./render')
const { wrapHtml, wrapText } = require('./layout')
const { getProvider } = require('./providers')

const MAX_ATTEMPTS = 3

async function getTemplate(templateId) {
  const base = BY_ID[templateId]
  const override = await EmailTemplate.findOne({ templateId }).lean()
  if (!base && !override) return null
  return {
    templateId,
    name: override?.name || base?.name,
    subject: override?.subject || base?.subject,
    heading: base?.heading || override?.name || templateId,
    body: override?.html || base?.body,
    text: override?.text || null,
    cta: override?.ctaLabel ? { label: override.ctaLabel, urlVar: override.ctaUrlVar } : base?.cta,
    active: override ? override.active !== false : true,
    isSystem: override ? override.isSystem : !!base?.isSystem,
  }
}

/** Render a template with variables → { subject, html, text } */
async function renderTemplate(templateId, vars) {
  const t = await getTemplate(templateId)
  if (!t) throw new Error(`Unknown template ${templateId}`)
  const bodyHtml = renderString(t.body, vars)
  const heading = renderString(t.heading, vars, { html: false })
  const ctaUrl = t.cta?.urlVar ? vars[t.cta.urlVar] : null
  return {
    template: t,
    subject: renderString(t.subject, vars, { html: false }),
    html: wrapHtml({ heading, bodyHtml, ctaLabel: t.cta?.label, ctaUrl }),
    text: wrapText({ heading, bodyText: t.text ? renderString(t.text, vars, { html: false }) : stripHtml(bodyHtml), ctaLabel: t.cta?.label, ctaUrl }),
  }
}

/**
 * Queue a notification.
 * @returns {Promise<{status:'queued'|'duplicate'|'disabled', notification?}>}
 */
async function notify({
  eventType, templateId, customerId, orderId, paymentId, invoiceId, ticketId,
  to, extra = {}, idempotencyKey, delayMinutes = 0, skipIfOrderStatusIn = [],
  sensitive = false,   // e.g. OTP: sent immediately, never stored in readable form, not retried
}) {
  const settings = await NotificationSetting.getSettings()
  if ((settings.disabledTemplates || []).includes(templateId)) return { status: 'disabled' }
  const tpl = await getTemplate(templateId)
  if (!tpl || !tpl.active) return { status: 'disabled' }

  const order = orderId ? await ServiceOrder.findById(orderId).select('orderNumber user').lean() : null
  const key = idempotencyKey || [orderId || customerId || to, eventType, templateId].join(':')

  let n
  try {
    n = await Notification.create({
      customer: customerId || order?.user, order: orderId, orderNumber: order?.orderNumber,
      templateId, eventType, recipientEmail: to, idempotencyKey: key,
      nextAttemptAt: new Date(Date.now() + delayMinutes * 60000), skipIfOrderStatusIn,
      // Only references + non-secret extras are stored; data is re-read at send time.
      variables: { customerId, orderId, paymentId, invoiceId, ticketId, extra: sensitive ? {} : extra, sensitive },
    })
  } catch (err) {
    if (err.code === 11000) return { status: 'duplicate' }
    throw err
  }

  if (sensitive) await processNotification(n._id, { extraSecret: extra })
  else if (!delayMinutes) setImmediate(() => processNotification(n._id).catch(e => console.error('[Notify]', e.message)))
  return { status: 'queued', notification: n }
}

/** Claim + send one notification. Safe to call concurrently (atomic claim). */
async function processNotification(id, { extraSecret } = {}) {
  const n = await Notification.findOneAndUpdate(
    { _id: id, status: 'QUEUED' }, { status: 'PROCESSING' }, { new: true }
  )
  if (!n) return null

  try {
    if (n.order && n.skipIfOrderStatusIn?.length) {
      const o = await ServiceOrder.findById(n.order).select('status').lean()
      if (o && n.skipIfOrderStatusIn.includes(o.status)) {
        n.status = 'SKIPPED'; n.failureReason = `Order is now ${o.status}`; await n.save(); return n
      }
    }
    const ref = n.variables || {}
    const vars = await buildVariables({ ...ref, extra: { ...(ref.extra || {}), ...(extraSecret || {}) } })
    const to = n.recipientEmail || vars.customer_email
    if (!to) throw Object.assign(new Error('No recipient email address'), { permanent: true })
    const { subject, html, text } = await renderTemplate(n.templateId, vars)

    const provider = getProvider()
    n.attemptCount += 1
    const res = await provider.send({ to, subject, html, text })
    Object.assign(n, {
      status: 'SENT', sentAt: new Date(), provider: res.provider, providerMessageId: res.messageId,
      recipientEmail: to, subject, failureReason: undefined,
      // Never keep secrets (OTP) in the log in readable form.
      html: ref.sensitive ? '[hidden — contains a one-time code]' : html,
      text: ref.sensitive ? '[hidden — contains a one-time code]' : text,
    })
    await n.save()
    return n
  } catch (err) {
    const reason = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err.message
    if (n.attemptCount === 0) n.attemptCount = 1
    const settings = await NotificationSetting.getSettings()
    const delays = settings.retryDelaysMinutes?.length ? settings.retryDelaysMinutes : [5, 30]
    const canRetry = !err.permanent && !n.variables?.sensitive && n.attemptCount < MAX_ATTEMPTS
    n.failureReason = reason
    if (canRetry) {
      n.status = 'QUEUED'
      n.nextAttemptAt = new Date(Date.now() + (delays[n.attemptCount - 1] ?? delays[delays.length - 1]) * 60000)
    } else {
      n.status = 'FAILED'; n.failedAt = new Date()
      await EventLog.create({
        order: n.order, orderNumber: n.orderNumber, customer: n.customer, eventType: 'EMAIL_FAILED',
        metadata: { notificationId: n._id, templateId: n.templateId, reason },
      })
      console.error(`[Notify] FAILED ${n.templateId} → ${n.recipientEmail || n.customer}: ${reason}`)
    }
    await n.save()
    return n
  }
}

/** Re-send a notification (admin). Creates a new row linked to the original. */
async function resend(notificationId, by = 'admin') {
  const orig = await Notification.findById(notificationId).lean()
  if (!orig) throw new Error('Notification not found')
  if (orig.variables?.sensitive) throw new Error('One-time-code emails cannot be resent. Ask the customer to request a new code.')
  const n = await Notification.create({
    customer: orig.customer, order: orig.order, orderNumber: orig.orderNumber, templateId: orig.templateId,
    eventType: orig.eventType, recipientEmail: orig.recipientEmail, variables: orig.variables,
    idempotencyKey: `${orig.idempotencyKey}:resend:${Date.now()}`, resendOf: orig._id,
  })
  await EventLog.create({ order: orig.order, orderNumber: orig.orderNumber, customer: orig.customer, eventType: 'EMAIL_RESENT', triggeredBy: by, metadata: { originalId: orig._id, templateId: orig.templateId } })
  return processNotification(n._id)
}

/** Worker tick: send due queued emails + recover rows stuck in PROCESSING. */
async function processDue(limit = 25) {
  await Notification.updateMany(
    { status: 'PROCESSING', updatedAt: { $lt: new Date(Date.now() - 10 * 60000) } },
    { status: 'QUEUED' }
  )
  const due = await Notification.find({ status: 'QUEUED', nextAttemptAt: { $lte: new Date() } }).sort({ nextAttemptAt: 1 }).limit(limit).select('_id').lean()
  for (const d of due) await processNotification(d._id).catch(e => console.error('[Notify worker]', e.message))
  return due.length
}

module.exports = { notify, processNotification, processDue, resend, getTemplate, renderTemplate }
