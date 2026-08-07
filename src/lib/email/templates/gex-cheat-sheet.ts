import { SITE } from "@/lib/site";
import { emailLayout } from "@/lib/email/layout";

/**
 * The exit-intent capture's promised lead magnet — a self-contained cheat
 * sheet, not a PDF attachment (no asset pipeline for that exists, and inline
 * HTML renders everywhere without an attachment being flagged/blocked).
 */
export function gexCheatSheetEmail(): { subject: string; html: string } {
  const subject = "Your GEX cheat sheet — gamma flip, call wall, put wall";

  const body = `
    <h1 style="font-size:21px;font-weight:800;margin:0 0 16px;color:#0f172a;">Your GEX Cheat Sheet</h1>
    <p style="margin:0 0 22px;color:#334155;">Three terms, one framework — this is the read professional desks use to know where price is likely to pin or accelerate.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      <tr><td style="padding:14px 16px;border-left:3px solid #0891b2;background:#f8fafc;border-radius:0 8px 8px 0;">
        <p style="margin:0 0 4px;font-weight:700;color:#0f172a;">Gamma Flip</p>
        <p style="margin:0;color:#475569;font-size:14px;">The price where dealers switch from long to short gamma. Above it, hedging dampens moves. Below it, hedging amplifies them — the single most important level to know before you trade.</p>
      </td></tr>
      <tr><td style="height:10px;"></td></tr>
      <tr><td style="padding:14px 16px;border-left:3px solid #16a34a;background:#f8fafc;border-radius:0 8px 8px 0;">
        <p style="margin:0 0 4px;font-weight:700;color:#0f172a;">Call Wall</p>
        <p style="margin:0;color:#475569;font-size:14px;">The strike with the largest positive dealer gamma — mechanical resistance, not a chart pattern.</p>
      </td></tr>
      <tr><td style="height:10px;"></td></tr>
      <tr><td style="padding:14px 16px;border-left:3px solid #dc2626;background:#f8fafc;border-radius:0 8px 8px 0;">
        <p style="margin:0 0 4px;font-weight:700;color:#0f172a;">Put Wall</p>
        <p style="margin:0;color:#475569;font-size:14px;">The mirror image — largest negative dealer gamma, acting as mechanical support.</p>
      </td></tr>
    </table>

    <p style="margin:0 0 20px;color:#334155;">Want to see these levels live for SPX/SPY/QQQ — free, no account needed?</p>

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;"><tr><td style="border-radius:8px;background:#0891b2;">
      <a href="${SITE.url}/tools/gamma-snapshot" style="display:inline-block;padding:13px 26px;font-weight:700;color:#ffffff;text-decoration:none;font-size:14px;">See the live snapshot →</a>
    </td></tr></table>

    <p style="margin:0 0 8px;color:#64748b;font-size:14px;">Full explainers, with real SPX examples:</p>
    <p style="margin:0;font-size:14px;">
      <a href="${SITE.url}/learn/gamma-flip-explained" style="color:#0891b2;text-decoration:none;">Gamma Flip Explained</a><br />
      <a href="${SITE.url}/learn/call-wall-put-wall-explained" style="color:#0891b2;text-decoration:none;">Call Wall &amp; Put Wall Explained</a>
    </p>
  `;

  return { subject, html: emailLayout({ preheader: "Gamma flip, call wall, put wall — the 3-term framework.", bodyHtml: body }) };
}
