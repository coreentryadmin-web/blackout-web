import { SITE } from "@/lib/site";

/**
 * Shared HTML email chrome — header, footer with real Website/Discord/X links,
 * and consistent typography. Every template (gex-cheat-sheet, welcome-sequence)
 * renders its own body content through this so every email looks like it came
 * from the same product, not a one-off inline snippet per template.
 *
 * Light background deliberately, not the site's dark theme — dark HTML email
 * bodies render inconsistently across Gmail/Outlook/Apple Mail without a lot
 * of client-specific hackery; a clean light layout is the reliable choice.
 */
export function emailLayout(input: {
  /** Hidden preview text shown next to the subject line in most inbox lists. */
  preheader: string;
  bodyHtml: string;
}): string {
  const { preheader, bodyHtml } = input;
  return `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
</head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<span style="display:none;font-size:1px;color:#f4f5f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

<tr><td style="padding:28px 32px;border-bottom:1px solid #eef0f3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:15px;font-weight:800;letter-spacing:0.04em;color:#0f172a;">
      BLACK<span style="color:#0891b2;">OUT</span> <span style="font-weight:600;color:#64748b;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">Trades</span>
    </td>
  </tr></table>
</td></tr>

<tr><td style="padding:32px;color:#0f172a;font-size:15px;line-height:1.65;">
${bodyHtml}
</td></tr>

<tr><td style="padding:24px 32px;background:#fafbfc;border-top:1px solid #eef0f3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:12.5px;color:#64748b;">
      <a href="${SITE.url}" style="color:#0891b2;text-decoration:none;font-weight:600;">blackouttrades.com</a>
      <span style="color:#cbd5e1;padding:0 8px;">·</span>
      <a href="${SITE.social.discord.url}" style="color:#0891b2;text-decoration:none;font-weight:600;">Discord</a>
      <span style="color:#cbd5e1;padding:0 8px;">·</span>
      <a href="${SITE.social.x.url}" style="color:#0891b2;text-decoration:none;font-weight:600;">X / Twitter</a>
    </td>
  </tr></table>
  <p style="font-size:11.5px;color:#94a3b8;margin:14px 0 0;line-height:1.6;">
    BlackOut Trades — educational and informational only, not financial advice.<br />
    Didn't ask for this? Reply to this email or contact <a href="mailto:support@blackouttrades.com" style="color:#94a3b8;">support@blackouttrades.com</a> and we'll take you off the list.
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`.trim();
}
