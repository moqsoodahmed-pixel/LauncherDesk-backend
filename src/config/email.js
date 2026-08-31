/**
 * email.js — Brevo (formerly Sendinblue) transactional email
 *
 * Uses Brevo's REST API via axios (no nodemailer, no SMTP).
 * Set ONE env var in Railway:  BREVO_API_KEY=xkeysib-...
 *
 * All other controllers (contact, quote) call sendEmail() with the same
 * { to, subject, html, text, attachments } signature — no changes needed there.
 */

const axios = require('axios')

/* ── Core send function ──────────────────────────────────────────────────── */

/**
 * Send a transactional email via Brevo REST API.
 * @param {Object} opts
 * @param {string}   opts.to           Recipient email address
 * @param {string}   opts.subject      Email subject
 * @param {string}   opts.html         HTML body
 * @param {string}  [opts.text]        Plain-text fallback (optional)
 * @param {Array}   [opts.attachments] [{ filename, content (Buffer), contentType }]
 */
const sendEmail = async ({ to, subject, html, text, attachments, fromName, fromEmail, replyTo }) => {
  const payload = {
    sender: {
      name:  fromName  || process.env.EMAIL_FROM_NAME || 'LauncherDesk',
      email: fromEmail || process.env.EMAIL_FROM_ADDR || 'noreply@launcherdesk.in',
    },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    ...(text    ? { textContent: text } : {}),
    // replyTo lets HR hit Reply and email the applicant directly
    ...(replyTo ? { replyTo: { name: replyTo.name, email: replyTo.email } } : {}),
  }

  // Brevo attachments: base64-encode the Buffer
  if (attachments && attachments.length > 0) {
    payload.attachment = attachments.map(a => ({
      name:    a.filename,
      content: Buffer.isBuffer(a.content)
                 ? a.content.toString('base64')
                 : a.content,           // already base64 string
    }))
  }

  let response
  try {
    response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      payload,
      {
        headers: {
          'api-key':      process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept':       'application/json',
        },
      }
    )
  } catch (err) {
    const detail = err?.response?.data
    console.error('[Brevo] Send failed:', JSON.stringify(detail || err.message))
    throw new Error(detail?.message || err.message)
  }

  console.log('[Brevo] Email sent, messageId:', response.data?.messageId)
  return response.data
}

/* ── Email Templates ─────────────────────────────────────────────────────── */

const contactAckEmail = (name) => ({
  subject: 'We received your enquiry — LauncherDesk',
  html: `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a2b3c">
      <h2 style="color:#0a2540">Hi ${name},</h2>
      <p>Thanks for reaching out to LauncherDesk. One of our experts will get back to you within 24 hours.</p>
      <p>In the meantime, you can explore our services at <a href="https://launcherdesk.in">launcherdesk.in</a>.</p>
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
        ${data.source  ? `<tr><td style="padding:8px 0;font-weight:600">Source</td><td>${data.source}</td></tr>` : ''}
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
        <p style="font-size:15px;color:#374151;line-height:1.7">Thank you for requesting a quote for <strong>${serviceTitle || 'our service'}</strong>. One of our experts will contact you within <strong>1 business day</strong> with a clear, itemised quote.</p>
        <div style="background:#EFF6FF;border-left:4px solid #1D6FE0;border-radius:6px;padding:16px 18px;margin:20px 0">
          <p style="margin:0;font-size:14px;color:#1E40AF;font-weight:600">What happens next?</p>
          <ul style="margin:8px 0 0;padding-left:18px;color:#1D4ED8;font-size:14px;line-height:1.8">
            <li>Our expert will review your requirement</li>
            <li>We will send you a detailed, transparent quote</li>
            <li>Professional fee + Govt. fee + Taxes — shown separately</li>
            <li>No hidden charges, no commitment until you approve</li>
          </ul>
        </div>
        <p style="font-size:14px;color:#64748B">Need something urgent? WhatsApp us at <a href="https://wa.me/918548854859" style="color:#1D6FE0;font-weight:600">+91 85488 54859</a></p>
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
        ${data.businessType   ? `<tr><td style="padding:8px 0;font-weight:600">Business Type</td><td>${data.businessType}</td></tr>` : ''}
        ${data.additionalInfo ? `<tr><td style="padding:8px 0;font-weight:600">Additional Info</td><td>${data.additionalInfo}</td></tr>` : ''}
      </table>
    </div>
  `,
})

/* ── Job Application Templates ───────────────────────────────────────────── */

const applicationNotifyEmail = (data) => ({
  subject: `New Job Application: ${data.role} — ${data.firstName} ${data.lastName}`,
  html: `
    <div style="font-family:sans-serif;max-width:620px;margin:0 auto;color:#1a2b3c">
      <div style="background:linear-gradient(135deg,#1A2F4E,#1D6FE0);padding:28px 28px 24px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;font-size:20px;margin:0">New Job Application Received</h1>
        <p style="color:rgba(255,255,255,.75);margin:6px 0 0;font-size:14px">LauncherDesk Careers</p>
      </div>
      <div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr style="background:#F8FAFF"><td style="padding:10px 12px;font-weight:700;width:160px;border:1px solid #e2e8f0;font-size:13px">Role Applied</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#1D6FE0">${data.role}</td></tr>
          <tr><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px">Full Name</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px">${data.firstName} ${data.lastName}</td></tr>
          <tr style="background:#F8FAFF"><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px">Email</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px"><a href="mailto:${data.email}" style="color:#1D6FE0">${data.email}</a></td></tr>
          <tr><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px">Phone</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px">${data.phone}</td></tr>
          <tr style="background:#F8FAFF"><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px">City</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px">${data.city || '—'}</td></tr>
          ${data.experience    ? `<tr><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px">Experience</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px">${data.experience}</td></tr>` : ''}
          ${data.education     ? `<tr style="background:#F8FAFF"><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px">Education</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px">${data.education}</td></tr>` : ''}
          ${data.currentCompany? `<tr><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px">Current Company</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px">${data.currentCompany}</td></tr>` : ''}
          ${data.linkedIn      ? `<tr style="background:#F8FAFF"><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px">LinkedIn</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px"><a href="${data.linkedIn}" style="color:#1D6FE0">${data.linkedIn}</a></td></tr>` : ''}
          ${data.coverLetter   ? `<tr><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px;vertical-align:top">Cover Letter</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px;line-height:1.6">${data.coverLetter.replace(/\n/g,'<br/>')}</td></tr>` : ''}
          ${data.resumeName
            ? `<tr style="background:#F8FAFF"><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px">Resume</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px">📎 <strong>${data.resumeName}</strong> — attached to this email</td></tr>`
            : `<tr style="background:#F8FAFF"><td style="padding:10px 12px;font-weight:700;border:1px solid #e2e8f0;font-size:13px">Resume</td><td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:13px;color:#94A3B8">Not uploaded</td></tr>`
          }
        </table>
        <p style="font-size:12px;color:#94A3B8;text-align:center;margin-top:20px">Submitted via LauncherDesk Careers · <a href="https://launcherdesk.in/company/careers" style="color:#1D6FE0">launcherdesk.in/company/careers</a></p>
      </div>
    </div>
  `,
})

const applicationAckEmail = (firstName, role) => ({
  subject: `Application received — ${role} at LauncherDesk`,
  html: `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a2b3c">
      <div style="background:linear-gradient(135deg,#1A2F4E,#1D6FE0);padding:32px 28px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="color:#fff;font-size:22px;margin:0">Application Received ✅</h1>
      </div>
      <div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
        <p style="font-size:16px">Hi <strong>${firstName}</strong>,</p>
        <p style="font-size:15px;color:#374151;line-height:1.7">
          Thank you for applying for the <strong>${role}</strong> position at LauncherDesk.
          We have received your application and our HR team will review it shortly.
        </p>
        <div style="background:#EFF6FF;border-left:4px solid #1D6FE0;border-radius:6px;padding:16px 18px;margin:20px 0">
          <p style="margin:0;font-size:14px;color:#1E40AF;font-weight:600">What happens next?</p>
          <ul style="margin:8px 0 0;padding-left:18px;color:#1D4ED8;font-size:14px;line-height:1.9">
            <li>Our HR team will review your application within 3–5 business days</li>
            <li>Shortlisted candidates will be contacted for a telephonic screening</li>
            <li>Interview process: Phone → In-person / Video</li>
          </ul>
        </div>
        <p style="font-size:14px;color:#64748B">
          Questions? Email us at <a href="mailto:hr@launcherdesk.com" style="color:#1D6FE0;font-weight:600">hr@launcherdesk.com</a>
          or WhatsApp <a href="https://wa.me/918548854859" style="color:#1D6FE0;font-weight:600">+91 85488 54859</a>
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
        <p style="font-size:12px;color:#94A3B8;text-align:center">
          LauncherDesk — Startups Made Easy |
          <a href="https://launcherdesk.in" style="color:#1D6FE0">launcherdesk.in</a>
        </p>
      </div>
    </div>
  `,
})

module.exports = {
  sendEmail,
  contactAckEmail,
  contactNotifyEmail,
  quoteAckEmail,
  quoteNotifyEmail,
  applicationNotifyEmail,
  applicationAckEmail,
}