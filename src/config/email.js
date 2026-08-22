const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

/**
 * Send an email.
 * @param {Object} opts - { to, subject, html, text }
 */
const sendEmail = async ({ to, subject, html, text }) => {
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
  })
  return info
}

// ── Email Templates ─────────────────────────────────────────────────────────

const contactAckEmail = (name) => ({
  subject: 'We received your enquiry — LauncherDesk',
  html: `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a2b3c">
      <h2 style="color:#0a2540">Hi ${name},</h2>
      <p>Thanks for reaching out to LauncherDesk. One of our experts will get back to you within 24 hours.</p>
      <p>In the meantime, you can explore our services at <a href="https://launcherdesk.com">launcherdesk.com</a>.</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
      <p style="font-size:13px;color:#64748b">LauncherDesk — DutyLaunch Solutions Pvt Ltd<br/>
      472/7, 20th L Cross Rd, Koramangala, Bengaluru – 560095</p>
    </div>
  `,
})

const contactNotifyEmail = (data) => ({
  subject: `New Enquiry from ${data.name} — LauncherDesk`,
  html: `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a2b3c">
      <h2 style="color:#0a2540">New Contact Enquiry</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;font-weight:600;width:140px">Name</td><td>${data.name}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600">Mobile</td><td>${data.mobile}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600">Email</td><td>${data.email}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600">State</td><td>${data.state}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600">WhatsApp Opt-in</td><td>${data.whatsappOptin ? 'Yes' : 'No'}</td></tr>
        ${data.message ? `<tr><td style="padding:8px 0;font-weight:600">Message</td><td>${data.message}</td></tr>` : ''}
        ${data.source ? `<tr><td style="padding:8px 0;font-weight:600">Source</td><td>${data.source}</td></tr>` : ''}
      </table>
    </div>
  `,
})

const quoteNotifyEmail = (data) => ({
  subject: `New Quote Request for ${data.serviceTitle} — LauncherDesk`,
  html: `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a2b3c">
      <h2 style="color:#0a2540">New Quote Request</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;font-weight:600;width:160px">Service</td><td>${data.serviceTitle} (${data.serviceSlug})</td></tr>
        <tr><td style="padding:8px 0;font-weight:600">Name</td><td>${data.name}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600">Email</td><td>${data.email}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600">Mobile</td><td>${data.mobile}</td></tr>
        <tr><td style="padding:8px 0;font-weight:600">State</td><td>${data.state}</td></tr>
        ${data.businessType ? `<tr><td style="padding:8px 0;font-weight:600">Business Type</td><td>${data.businessType}</td></tr>` : ''}
        ${data.additionalInfo ? `<tr><td style="padding:8px 0;font-weight:600">Additional Info</td><td>${data.additionalInfo}</td></tr>` : ''}
      </table>
    </div>
  `,
})

module.exports = { sendEmail, contactAckEmail, contactNotifyEmail, quoteNotifyEmail }
