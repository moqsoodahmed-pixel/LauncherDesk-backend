const env = require('../config/portal');

/**
 * The ONE branded wrapper every outbound email is rendered through -
 * communicationProcessor.service.js's sendViaProvider() applies this to
 * every template's inner html, so adding this file never required editing
 * each individual template in communication/templates.js. Deliberately
 * table-based, inline-styled HTML (no <style> blocks, no external CSS,
 * no JS) - this is what actually survives Gmail/Outlook rendering, and is
 * what makes a single template "responsive and mobile friendly" across
 * webmail clients that strip <head> styles.
 *
 * innerHtml is already-rendered template content (see renderTemplate.js) -
 * this function only adds the logo header and the company/support/legal
 * footer around it. It never re-escapes or re-renders innerHtml.
 */
function wrapEmailLayout(innerHtml) {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LauncherDesk</title>
  </head>
  <body style="margin:0;padding:0;background-color:#F1F5F9;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F1F5F9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;width:100%;background-color:#FFFFFF;border-radius:12px;overflow:hidden;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:linear-gradient(135deg,#1D6FE0,#0F52C0);padding:24px 28px;" align="center">
                <span style="font-size:20px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;">LauncherDesk</span>
                <div style="font-size:11px;color:#DCEBFF;margin-top:2px;">Startups Made Easy</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px 28px;color:#0F172A;font-size:14px;line-height:1.6;">
                ${innerHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px 28px;">
                <hr style="border:none;border-top:1px solid #E2E8F0;margin:0 0 16px 0;" />
                <div style="font-size:11.5px;color:#64748B;line-height:1.6;">
                  <div style="font-weight:700;color:#334155;margin-bottom:4px;">LauncherDesk</div>
                  <div>Need help? Write to us at <a href="mailto:${env.SUPPORT_EMAIL}" style="color:#1D6FE0;text-decoration:none;">${env.SUPPORT_EMAIL}</a></div>
                  <div style="margin-top:4px;"><a href="${env.CLIENT_URL}" style="color:#1D6FE0;text-decoration:none;">${env.CLIENT_URL}</a></div>
                  <div style="margin-top:10px;color:#94A3B8;">&copy; ${year} LauncherDesk. All rights reserved.</div>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** A single prominent call-to-action button, styled inline to survive webmail clients. */
function emailButton(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="border-radius:8px;background:linear-gradient(135deg,#1D6FE0,#0F52C0);"><a href="${url}" style="display:inline-block;padding:12px 24px;color:#FFFFFF;font-weight:700;font-size:13.5px;text-decoration:none;border-radius:8px;">${label}</a></td></tr></table>`;
}

module.exports = { wrapEmailLayout, emailButton };
