/**
 * Branded, table-based email layout (works in Gmail, Outlook, Apple Mail; mobile responsive).
 */
const { esc } = require('./render')

function wrapHtml({ heading, bodyHtml, ctaLabel, ctaUrl, preheader }) {
  const site = process.env.CLIENT_URL || 'https://launcherdesk.com'
  const logo = process.env.EMAIL_LOGO_URL || `${site}/launcherdesk-logo-transparent.png`
  const support = `${site}/user/dashboard?tab=support`
  const cta = ctaLabel && ctaUrl ? `
            <tr><td align="center" style="padding:8px 0 28px">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
                <td align="center" bgcolor="#1D6FE0" style="border-radius:8px">
                  <a href="${esc(ctaUrl)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px">${esc(ctaLabel)}</a>
                </td></tr></table>
            </td></tr>` : ''
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><title>${esc(heading)}</title>
<style>@media only screen and (max-width:620px){.ld-card{width:100%!important}.ld-pad{padding:22px 18px!important}}</style></head>
<body style="margin:0;padding:0;background:#F1F5F9">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${esc(preheader || heading)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F1F5F9"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" class="ld-card" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px">
    <tr><td align="center" style="padding:6px 0 18px"><img src="${esc(logo)}" alt="LauncherDesk" height="38" style="height:38px;border:0;display:block"></td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #E2E8F0;border-radius:12px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr><td class="ld-pad" style="padding:32px 34px 8px;font-family:Arial,Helvetica,sans-serif">
          <h1 style="margin:0 0 16px;font-size:21px;line-height:1.35;color:#0A2540">${esc(heading)}</h1>
          <div style="font-size:15px;line-height:1.65;color:#334155">${bodyHtml}</div>
        </td></tr>${cta}
      </table>
    </td></tr>
    <tr><td align="center" style="padding:22px 10px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.7;color:#64748B">
      <strong style="color:#0A2540">LauncherDesk</strong><br>Your Business. Simplified.<br>
      <a href="${esc(site)}" style="color:#1D6FE0;text-decoration:none">Website</a> &nbsp;|&nbsp;
      <a href="${esc(support)}" style="color:#1D6FE0;text-decoration:none">Support</a> &nbsp;|&nbsp;
      <a href="${esc(site)}/user/dashboard" style="color:#1D6FE0;text-decoration:none">Dashboard</a><br>
      &copy; ${new Date().getFullYear()} LauncherDesk Solutions Private Limited. All rights reserved.
    </td></tr>
  </table>
</td></tr></table></body></html>`
}

function wrapText({ heading, bodyText, ctaLabel, ctaUrl }) {
  const site = process.env.CLIENT_URL || 'https://launcherdesk.com'
  return [
    heading, '', bodyText, '',
    ctaLabel && ctaUrl ? `${ctaLabel}: ${ctaUrl}\n` : '',
    '—', 'LauncherDesk — Your Business. Simplified.', `Website: ${site}  |  Dashboard: ${site}/user/dashboard`,
    `© ${new Date().getFullYear()} LauncherDesk Solutions Private Limited. All rights reserved.`,
  ].join('\n')
}

module.exports = { wrapHtml, wrapText }
