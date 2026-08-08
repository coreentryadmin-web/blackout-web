import { SITE } from "@/lib/site";
import { chromeAssets, cidSrc, discordBadgeAsset, logoAsset, xBadgeAsset, type InlineAsset } from "@/lib/email/inline-assets";

/**
 * Shared HTML email chrome — header, footer with real Website/Discord/X links,
 * and consistent typography. Every template (gex-cheat-sheet, welcome-sequence,
 * billing-lifecycle) renders its own body content through this so every email
 * looks like it came from the same product, not a one-off inline snippet.
 *
 * Header/footer intentionally mirror the real site chrome (Nav.tsx / marketing
 * footer): near-black bar, the actual PWA icon as the logo mark, and the same
 * lime accent (#a3e635) the nav uses on hover/the nav-dot — not an invented
 * email-only palette. The body card stays light — dark HTML email bodies
 * render inconsistently across Gmail/Outlook/Apple Mail without a lot of
 * client-specific hackery, so only the chrome (not the reading surface) goes
 * dark. Brand neons (#a3e635 lime, #22d3ee cyan, etc.) are used at full
 * brightness on the dark chrome and as thin decorative accents on the white
 * body (borders, buttons-with-dark-text) but never as small body text on
 * white — they fail contrast there, so body text links use a darkened
 * lime (#4d7c0f) instead.
 *
 * All images (logo, Discord/X badges, product screenshots) are embedded as
 * real inline (CID) attachments via lib/email/inline-assets.ts, not hosted
 * URLs — see that file's comment for why. emailLayout() returns the
 * attachments its own chrome needs; a template merges those with any of its
 * own (e.g. emailScreenshot's asset) into the final sendEmail() call.
 */
export const EMAIL_BRAND = {
  bg: "#f4f5f7",
  card: "#ffffff",
  chrome: "#05060a",
  lime: "#a3e635",
  limeText: "#4d7c0f",
  cyan: "#22d3ee",
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
} as const;

export function emailLayout(input: {
  /** Hidden preview text shown next to the subject line in most inbox lists. */
  preheader: string;
  bodyHtml: string;
  /** Set ONLY for marketing-category sends (welcome sequence, cheat sheet) —
   *  renders a real one-click unsubscribe link in the footer instead of the
   *  generic "reply to opt out" line. Billing/lifecycle emails must NOT set
   *  this — see lib/email/unsubscribe-token.ts's header comment for why. */
  unsubscribeUrl?: string | null;
}): { html: string; attachments: InlineAsset[] } {
  const { preheader, bodyHtml, unsubscribeUrl } = input;
  const logo = logoAsset();
  const discord = discordBadgeAsset();
  const x = xBadgeAsset();
  const html = `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
</head>
<body style="margin:0;padding:0;background:${EMAIL_BRAND.bg};">
<span style="display:none;font-size:1px;color:${EMAIL_BRAND.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_BRAND.bg};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${EMAIL_BRAND.card};border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

<tr><td style="padding:22px 32px;background:${EMAIL_BRAND.chrome};">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="width:38px;vertical-align:middle;">
      <img src="${cidSrc(logo)}" width="34" height="34" alt="BlackOut" style="display:block;border-radius:8px;" />
    </td>
    <td style="vertical-align:middle;padding-left:11px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:7px;height:7px;border-radius:50%;background:${EMAIL_BRAND.lime};box-shadow:0 0 8px ${EMAIL_BRAND.lime};line-height:0;font-size:0;">&nbsp;</td>
        <td style="padding-left:8px;font-size:16px;font-weight:800;letter-spacing:0.05em;color:#ffffff;">BLACKOUT</td>
      </tr></table>
      <p style="margin:2px 0 0 15px;font-size:9.5px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${EMAIL_BRAND.cyan};">Trades</p>
    </td>
  </tr></table>
</td></tr>

<tr><td style="padding:32px;color:${EMAIL_BRAND.ink};font-size:15px;line-height:1.65;">
${bodyHtml}
</td></tr>

<tr><td style="padding:26px 32px;background:#fafbfc;border-top:1px solid #eef0f3;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:20px;">
      <a href="${SITE.url}" style="text-decoration:none;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td><img src="${cidSrc(logo)}" width="18" height="18" alt="" style="display:block;border-radius:5px;" /></td>
          <td style="padding-left:6px;font-size:12.5px;font-weight:700;color:${EMAIL_BRAND.ink};">blackouttrades.com</td>
        </tr></table>
      </a>
    </td>
    <td style="padding-right:20px;">
      <a href="${SITE.social.discord.url}" style="text-decoration:none;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td><img src="${cidSrc(discord)}" width="18" height="18" alt="" style="display:block;border-radius:50%;" /></td>
          <td style="padding-left:6px;font-size:12.5px;font-weight:700;color:${EMAIL_BRAND.ink};">Discord</td>
        </tr></table>
      </a>
    </td>
    <td>
      <a href="${SITE.social.x.url}" style="text-decoration:none;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td><img src="${cidSrc(x)}" width="18" height="18" alt="" style="display:block;border-radius:50%;" /></td>
          <td style="padding-left:6px;font-size:12.5px;font-weight:700;color:${EMAIL_BRAND.ink};">X</td>
        </tr></table>
      </a>
    </td>
  </tr></table>
  <p style="font-size:11.5px;color:#94a3b8;margin:16px 0 0;line-height:1.6;">
    BlackOut Trades — educational and informational only, not financial advice.<br />
    ${
      unsubscribeUrl
        ? `Didn't ask for this? <a href="${unsubscribeUrl}" style="color:#94a3b8;">Unsubscribe</a> or contact <a href="mailto:support@blackouttrades.com" style="color:#94a3b8;">support@blackouttrades.com</a>.`
        : `Didn't ask for this? Reply to this email or contact <a href="mailto:support@blackouttrades.com" style="color:#94a3b8;">support@blackouttrades.com</a> and we'll take you off the list.`
    }
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`.trim();
  return { html, attachments: chromeAssets() };
}

/** Same 6-hue accent system Nav.tsx assigns per engine (nav-accent-*) — reused
 *  here so a highlight item's color means the same thing in the email as it
 *  does on the site, instead of an email-only palette invented separately. */
export const ENGINE_ACCENT = {
  green: "#a3e635",
  purple: "#bf5fff",
  orange: "#ff6b2b",
  blue: "#22d3ee",
  red: "#ff2d55",
  teal: "#2dd4bf",
} as const;
export type EngineAccent = keyof typeof ENGINE_ACCENT;

/** The lime CTA button used across every template — bright lime bg with
 *  near-black text reads as a highlighter-style call to action and is the
 *  one accent from the brand palette with enough contrast to double as a
 *  button background (unlike the neons used as text links). */
export function emailCta(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;"><tr><td style="border-radius:8px;background:${EMAIL_BRAND.lime};">
    <a href="${href}" style="display:inline-block;padding:13px 26px;font-weight:800;color:${EMAIL_BRAND.chrome};text-decoration:none;font-size:14px;">${label}</a>
  </td></tr></table>`;
}

/** A left-border accent box for a labeled concept/product — pass one of
 *  ENGINE_ACCENT's hues. Full-brightness neon is safe here since it colors a
 *  3px decorative border, not body text. */
export function emailHighlight(label: string, description: string, accent: string): string {
  return `<tr><td style="padding:14px 16px;border-left:3px solid ${accent};background:#f8fafc;border-radius:0 8px 8px 0;">
        <p style="margin:0 0 4px;font-weight:700;color:${EMAIL_BRAND.ink};">${label}</p>
        <p style="margin:0;color:#475569;font-size:14px;">${description}</p>
      </td></tr>
      <tr><td style="height:10px;"></td></tr>`;
}

/** A real product-screenshot block — rounded, thin dark border so it reads as
 *  a genuine app window rather than a random pasted image. Pass one of the
 *  InlineAsset getters from lib/email/inline-assets.ts; the caller must add
 *  the SAME asset to the attachments list handed to sendEmail(). */
export function emailScreenshot(asset: InlineAsset, alt: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="border-radius:10px;overflow:hidden;border:1px solid #1c2333;line-height:0;">
    <img src="${cidSrc(asset)}" width="496" alt="${alt}" style="display:block;width:100%;max-width:496px;height:auto;" />
  </td></tr></table>`;
}

/** Simple {{token}} substitution shared by the billing-lifecycle templates
 *  (firstName, accessUntil, graceDays, ...) — same idea as welcome-sequence's
 *  local personalize(), pulled out here so new templates don't each redefine it. */
export function substituteTokens(text: string, tokens: Record<string, string>): string {
  return Object.entries(tokens).reduce((acc, [key, value]) => acc.split(`{{${key}}}`).join(value), text);
}
