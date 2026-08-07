import { SITE } from "@/lib/site";

/**
 * The exit-intent capture's promised lead magnet — a self-contained cheat
 * sheet, not a PDF attachment (no asset pipeline for that exists, and inline
 * HTML renders everywhere without an attachment being flagged/blocked).
 */
export function gexCheatSheetEmail(): { subject: string; html: string } {
  const subject = "Your GEX cheat sheet — gamma flip, call wall, put wall";
  const html = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;color:#111;line-height:1.6;">
  <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#0891b2;font-weight:700;margin:0 0 8px;">BlackOut Trades</p>
  <h1 style="font-size:22px;margin:0 0 16px;">Your GEX Cheat Sheet</h1>
  <p style="margin:0 0 20px;">Three terms, one framework — this is the whole read professional desks use to know where price is likely to pin or accelerate.</p>

  <div style="border-left:3px solid #0891b2;padding:4px 0 4px 16px;margin:0 0 18px;">
    <p style="margin:0 0 4px;font-weight:700;">Gamma Flip</p>
    <p style="margin:0;color:#444;">The price where dealers switch from long to short gamma. Above it, dealer hedging tends to <em>dampen</em> moves (dip-buying, range-bound). Below it, hedging tends to <em>amplify</em> moves (volatility expands). This is the single most important level to know before you put on a trade.</p>
  </div>

  <div style="border-left:3px solid #22c55e;padding:4px 0 4px 16px;margin:0 0 18px;">
    <p style="margin:0 0 4px;font-weight:700;">Call Wall</p>
    <p style="margin:0;color:#444;">The strike with the largest positive dealer gamma — mechanical resistance. Not a chart pattern, not a round number: it's where hedging flows physically cap upside.</p>
  </div>

  <div style="border-left:3px solid #ef4444;padding:4px 0 4px 16px;margin:0 0 24px;">
    <p style="margin:0 0 4px;font-weight:700;">Put Wall</p>
    <p style="margin:0;color:#444;">The mirror image — largest negative dealer gamma, acting as mechanical support.</p>
  </div>

  <p style="margin:0 0 20px;">Want to see these levels live, updated continuously, for SPX/SPY/QQQ — free, no account needed?</p>

  <p style="margin:0 0 28px;">
    <a href="${SITE.url}/tools/gamma-snapshot" style="display:inline-block;background:#22d3ee;color:#000;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:8px;">See the live snapshot →</a>
  </p>

  <p style="margin:0 0 8px;color:#444;">Full explainers, with real SPX examples:</p>
  <ul style="margin:0 0 28px;padding-left:20px;color:#444;">
    <li><a href="${SITE.url}/learn/gamma-flip-explained" style="color:#0891b2;">Gamma Flip Explained</a></li>
    <li><a href="${SITE.url}/learn/call-wall-put-wall-explained" style="color:#0891b2;">Call Wall &amp; Put Wall Explained</a></li>
  </ul>

  <hr style="border:none;border-top:1px solid #eee;margin:0 0 16px;" />
  <p style="font-size:12px;color:#888;margin:0 0 4px;">BlackOut Trades — educational and informational only, not financial advice.</p>
  <p style="font-size:12px;color:#888;margin:0;">Didn't ask for this? Reply to this email or contact <a href="mailto:support@blackouttrades.com" style="color:#888;">support@blackouttrades.com</a> and we'll take you off the list.</p>
</div>`.trim();
  return { subject, html };
}
