/**
 * Email providers — the notification engine only ever calls `getProvider().send()`,
 * so switching provider is a single env change:  EMAIL_PROVIDER=brevo|sendgrid|resend|mailgun|console
 *
 * Every provider returns { provider, messageId } or throws.
 */
const axios = require('axios')

const from = () => ({
  name:  process.env.EMAIL_FROM_NAME || 'LauncherDesk',
  email: process.env.EMAIL_FROM_ADDR || 'noreply@launcherdesk.in',
})
const replyTo = () => process.env.EMAIL_REPLY_TO || process.env.SUPPORT_EMAIL || undefined

const providers = {
  brevo: {
    async send({ to, subject, html, text, attachments }) {
      const payload = {
        sender: from(), to: [{ email: to }], subject, htmlContent: html,
        ...(text ? { textContent: text } : {}),
        ...(replyTo() ? { replyTo: { email: replyTo() } } : {}),
        ...(attachments?.length ? { attachment: attachments.map(a => ({ name: a.filename, content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content })) } : {}),
      }
      const r = await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
        headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 20000,
      })
      return { provider: 'brevo', messageId: r.data?.messageId }
    },
  },

  sendgrid: {
    async send({ to, subject, html, text, attachments }) {
      const f = from()
      const payload = {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: f.email, name: f.name },
        ...(replyTo() ? { reply_to: { email: replyTo() } } : {}),
        subject,
        content: [...(text ? [{ type: 'text/plain', value: text }] : []), { type: 'text/html', value: html }],
        ...(attachments?.length ? { attachments: attachments.map(a => ({ filename: a.filename, type: a.contentType, content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content })) } : {}),
      }
      const r = await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
        headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000,
      })
      return { provider: 'sendgrid', messageId: r.headers?.['x-message-id'] }
    },
  },

  resend: {
    async send({ to, subject, html, text, attachments }) {
      const f = from()
      const payload = {
        from: `${f.name} <${f.email}>`, to: [to], subject, html, ...(text ? { text } : {}),
        ...(replyTo() ? { reply_to: replyTo() } : {}),
        ...(attachments?.length ? { attachments: attachments.map(a => ({ filename: a.filename, content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content })) } : {}),
      }
      const r = await axios.post('https://api.resend.com/emails', payload, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000,
      })
      return { provider: 'resend', messageId: r.data?.id }
    },
  },

  mailgun: {
    async send({ to, subject, html, text }) {
      const f = from()
      const domain = process.env.MAILGUN_DOMAIN
      const base = process.env.MAILGUN_REGION === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net'
      const form = new URLSearchParams({ from: `${f.name} <${f.email}>`, to, subject, html, ...(text ? { text } : {}), ...(replyTo() ? { 'h:Reply-To': replyTo() } : {}) })
      const r = await axios.post(`${base}/v3/${domain}/messages`, form, {
        auth: { username: 'api', password: process.env.MAILGUN_API_KEY }, timeout: 20000,
      })
      return { provider: 'mailgun', messageId: r.data?.id }
    },
  },

  // Development / testing: prints the email instead of sending it.
  console: {
    async send({ to, subject, text }) {
      console.log(`[Email:console] To: ${to}\n  Subject: ${subject}\n  ${String(text || '').slice(0, 400)}`)
      return { provider: 'console', messageId: `console-${Date.now()}` }
    },
  },
}

function getProvider() {
  const name = (process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : 'console')).toLowerCase()
  const p = providers[name]
  if (!p) throw new Error(`Unknown EMAIL_PROVIDER "${name}". Use one of: ${Object.keys(providers).join(', ')}`)
  return { name, ...p }
}

module.exports = { getProvider }
