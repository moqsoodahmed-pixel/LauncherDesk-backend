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

const quoteAckEmail = (name, serviceTitle) => ({
  subject: `We received your quote request — LauncherDesk`,
  html: `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a2b3c">
      <div style="background:linear-gradient(135deg,#1A2F4E,#1D6FE0);padding:32px 28px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:#fff;font-size:22px;margin:0">Quote Request Received ✅</h1>
      </div>
      <div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
        <p style="font-size:16px;color:#1a2b3c">Hi <strong>${name}</strong>,</p>
        <p style="font-size:15px;color:#374151;line-height:1.7">Thank you for requesting a quote for <strong>${serviceTitle || 'our service'}</strong>. We have received your request and one of our experts will contact you within <strong>1 business day</strong> with a clear, itemised quote.</p>
        <div style="background:#EFF6FF;border-left:4px solid #1D6FE0;border-radius:6px;padding:16px 18px;margin:20px 0">
          <p style="margin:0;font-size:14px;color:#1E40AF;font-weight:600">What happens next?</p>
          <ul style="margin:8px 0 0;padding-left:18px;color:#1D4ED8;font-size:14px;line-height:1.8">
            <li>Our expert will review your requirement</li>
            <li>We will send you a detailed, transparent quote</li>
            <li>Professional fee + Govt. fee + Taxes — shown separately</li>
            <li>No hidden charges, no commitment until you approve</li>
          </ul>
        </div>
        <p style="font-size:14px;color:#64748B">Need something urgent? WhatsApp us directly at <a href="https://wa.me/918548854859" style="color:#1D6FE0;font-weight:600">+91 85488 54859</a></p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
        <p style="font-size:12px;color:#94A3B8;text-align:center">LauncherDesk — Startups Made Easy | <a href="https://launcherdesk.in" style="color:#1D6FE0">launcherdesk.in</a></p>
      </div>
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

module.exports = { sendEmail, contactAckEmail, contactNotifyEmail, quoteNotifyEmail, quoteAckEmail }