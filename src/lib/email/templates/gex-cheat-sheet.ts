import { SITE } from "@/lib/site";
import { emailLayout, emailCta, emailHighlight, emailScreenshot, ENGINE_ACCENT, EMAIL_BRAND } from "@/lib/email/layout";
import { thermalKeyLevelsAsset } from "@/lib/email/inline-assets";
import { marketingUnsubscribe } from "@/lib/email/unsubscribe-token";
import type { EmailAttachment } from "@/lib/email/resend-client";

/**
 * The exit-intent capture's promised lead magnet — a self-contained cheat
 * sheet, not a PDF attachment (no asset pipeline for that exists, and inline
 * HTML renders everywhere without an attachment being flagged/blocked). The
 * capture flow only collects an email (no name field on the modal), so this
 * is the one email in the set that stays un-personalized. Marketing-category
 * send — takes the recipient so it can embed a real one-click unsubscribe
 * link (see lib/email/unsubscribe-token.ts).
 */
export function gexCheatSheetEmail(recipientEmail: string): {
  subject: string;
  html: string;
  attachments: EmailAttachment[];
  headers: Record<string, string>;
} {
  const subject = "What the dealers know before you ever click buy";
  const thermalShot = thermalKeyLevelsAsset();
  const { url: unsubUrl, headers: unsubHeaders } = marketingUnsubscribe(recipientEmail);

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">Your Cursor Was Already Moving For The X.</h1>
    <p style="margin:0 0 24px;color:${EMAIL_BRAND.body};">One more tab closing. One more trader gone before they ever saw the real board. That's how it usually goes — but you paused, half a second, right before the exit. That's the instinct that keeps traders alive on this tape. So here's your payoff, paid in full: the exact three-term framework dealers work inside every single session, the one most retail traders never even hear named. Learn it once and you stop watching the chart — you start reading it.</p>

    ${emailScreenshot(thermalShot, "Live BlackOut Thermal key levels — gamma flip, call wall, put wall")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      ${emailHighlight(
        "Gamma Flip",
        "The line in the sand for the entire session. Above it, dealers sit long gamma and lean against every move — spikes get sold, dips get bought, price gets pinned. Below it, they flip short gamma and start piling ON the move instead of fighting it — things get loose, fast. One number. Know which side of it you're standing on before you touch a single contract today.",
        ENGINE_ACCENT.blue
      )}
      ${emailHighlight(
        "Call Wall",
        "The strike holding the fattest positive dealer gamma on the board. Not a trendline someone eyeballed at 2am. Not vibes — dealers are mechanically forced to sell into strength the closer price grinds toward it. Ceiling until it isn't.",
        ENGINE_ACCENT.green
      )}
      ${emailHighlight(
        "Put Wall",
        "The mirror image of the call wall. Biggest negative dealer gamma on the board, forcing dealers to buy dips as price nears it — same cold mechanical math, opposite direction. That's your floor.",
        ENGINE_ACCENT.red
      )}
    </table>

    <p style="margin:0 0 20px;color:${EMAIL_BRAND.body};">Cheat sheet's locked in. But a cheat sheet can't tell you where these three lines are sitting right now, this session, on SPX, SPY, or QQQ — that's the version that actually matters.</p>

    ${emailCta(`${SITE.url}/tools/gamma-snapshot`, "Pull Up Today's Live Levels — Free")}

    <p style="margin:0 0 8px;color:${EMAIL_BRAND.muted};font-size:14px;">No login. No card. Just the tape, straight up. Full explainers, with real SPX examples:</p>
    <p style="margin:0;font-size:14px;">
      <a href="${SITE.url}/learn/gamma-flip-explained" style="color:${EMAIL_BRAND.limeText};text-decoration:none;font-weight:600;">Gamma Flip Explained</a><br />
      <a href="${SITE.url}/learn/call-wall-put-wall-explained" style="color:${EMAIL_BRAND.limeText};text-decoration:none;font-weight:600;">Call Wall &amp; Put Wall Explained</a>
    </p>
  `;

  const layout = emailLayout({
    preheader: "Gamma flip, call wall, put wall — the three-term framework that reads the tape before it moves. Free, live, no account needed.",
    bodyHtml: body,
    unsubscribeUrl: unsubUrl,
  });
  return { subject, html: layout.html, attachments: [...layout.attachments, thermalShot], headers: unsubHeaders };
}
