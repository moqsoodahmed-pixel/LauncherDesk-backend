/**
 * Background jobs (in-process; started from server.js once MongoDB is connected).
 *   every 1 min  — send queued / retry-due emails
 *   every 15 min — document reminders 1 → 2 → 3 → ORDER_ON_HOLD (intervals from admin settings)
 *   every 15 min — feedback request after completion (delay from admin settings)
 * Every step is idempotent, so running several server instances is safe.
 * Set DISABLE_SCHEDULER=true on extra instances if you prefer only one to run jobs.
 */
const ServiceOrder = require('../models/ServiceOrder')
const NotificationSetting = require('../models/NotificationSetting')
const { processDue } = require('./notification/engine')
const events = require('./events')
const orderService = require('./orderService')

const H = 3600000

async function documentReminders() {
  const s = await NotificationSetting.getSettings()
  const steps = [s.reminder1AfterHours, s.reminder2AfterHours, s.reminder3AfterHours]
  const orders = await ServiceOrder.find({
    status: { $in: ['DOCUMENTS_PENDING', 'DOCUMENT_CORRECTION_REQUIRED'] },
    documentsRequestedAt: { $ne: null },
  }).limit(200)

  for (const o of orders) {
    const since = (o.lastReminderAt || o.documentsRequestedAt).getTime()
    const elapsed = Date.now() - since
    if (o.reminderCount < 3) {
      if (elapsed < steps[o.reminderCount] * H) continue
      // claim atomically so two instances can't both send this reminder
      const claimed = await ServiceOrder.findOneAndUpdate(
        { _id: o._id, reminderCount: o.reminderCount },
        { $inc: { reminderCount: 1 }, lastReminderAt: new Date() }, { new: true }
      )
      if (!claimed) continue
      const evt = `DOCUMENT_REMINDER_${claimed.reminderCount}`
      await events.emit(evt, { orderId: o._id, triggeredBy: 'scheduler', dedupe: `${o.documentsRequestedAt.getTime()}` })
    } else if (elapsed >= s.holdAfterFinalReminderHours * H) {
      await orderService.changeStatus(o._id, 'ON_HOLD', {
        by: 'scheduler', notifyCustomer: true,
        set: { holdReason: 'We have not yet received the documents needed to start your order.' },
      })
    }
  }
}

async function feedbackRequests() {
  const s = await NotificationSetting.getSettings()
  const cutoff = new Date(Date.now() - s.feedbackDelayHours * H)
  const orders = await ServiceOrder.find({
    status: { $in: ['COMPLETED', 'DOCUMENTS_READY', 'CLOSED'] }, completedAt: { $lte: cutoff }, feedbackRequestedAt: null,
  }).limit(200)
  for (const o of orders) {
    const claimed = await ServiceOrder.findOneAndUpdate({ _id: o._id, feedbackRequestedAt: null }, { feedbackRequestedAt: new Date() })
    if (claimed) await events.emit('FEEDBACK_REQUEST', { orderId: o._id, triggeredBy: 'scheduler' })
  }
}

let started = false
function start() {
  if (started || process.env.DISABLE_SCHEDULER === 'true') return
  started = true
  const run = (name, fn) => () => fn().catch(e => console.error(`[Scheduler] ${name}:`, e.message))
  setInterval(run('email queue', processDue), 60 * 1000)
  setInterval(run('document reminders', documentReminders), 15 * 60 * 1000)
  setInterval(run('feedback', feedbackRequests), 15 * 60 * 1000)
  setTimeout(run('email queue', processDue), 5000)
  console.log('[Scheduler] Notification jobs started')
}

module.exports = { start, documentReminders, feedbackRequests }
