import sharp from "sharp";
import type { PostType } from "@/lib/x-content-types";
import type { MarketSnapshot } from "@/lib/x-content";

const PRODUCT_LABEL: Record<PostType, string> = {
  desk_open: "Night Hawk → Vector → SPX Slayer",
  desk_flow: "Helix flow + Thermal walls",
  desk_ai: "Largo AI + SPX Slayer",
  desk_matrix: "Thermal matrix + Vector ladder",
  desk_midday: "Full desk midday read",
  desk_close: "Close recap · SPX Slayer",
  desk_evening: "Dealer gamma · 6-tool desk",
  weekend_desk: "Weekend gamma prep",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Live-data desk card PNG — replaces static marketing webp in autopost. */
export async function renderDeskCardPng(
  postType: PostType,
  data: MarketSnapshot,
): Promise<Buffer> {
  const spx =
    data.spxPrice != null ? `$${Math.round(data.spxPrice).toLocaleString()}` : "SPX";
  const flip =
    data.flipLevel != null ? `$${Math.round(data.flipLevel).toLocaleString()}` : "—";
  const call =
    data.topCallWall != null ? `$${data.topCallWall}` : "—";
  const put = data.topPutWall != null ? `$${data.topPutWall}` : "—";
  const regime = esc((data.regime ?? "live desk").slice(0, 120));
  const product = esc(PRODUCT_LABEL[postType] ?? "BlackOut desk");

  const svg = `<svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0e14"/>
      <stop offset="100%" stop-color="#121a24"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="595" rx="16" fill="#0f1419" stroke="#2a3544" stroke-width="2"/>
  <text x="72" y="100" fill="#8b9cb3" font-family="system-ui,sans-serif" font-size="28" font-weight="600">@BlackOutTrade · LIVE DESK</text>
  <text x="72" y="200" fill="#e8edf4" font-family="system-ui,sans-serif" font-size="88" font-weight="700">${esc(spx)}</text>
  <text x="72" y="260" fill="#6ee7b7" font-family="system-ui,sans-serif" font-size="26">${regime}</text>
  <text x="72" y="340" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="24">Gamma flip</text>
  <text x="280" y="340" fill="#f1f5f9" font-family="system-ui,sans-serif" font-size="32" font-weight="600">${esc(flip)}</text>
  <text x="72" y="400" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="24">Call wall</text>
  <text x="280" y="400" fill="#fca5a5" font-family="system-ui,sans-serif" font-size="32" font-weight="600">${esc(String(call))}</text>
  <text x="520" y="400" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="24">Put wall</text>
  <text x="680" y="400" fill="#86efac" font-family="system-ui,sans-serif" font-size="32" font-weight="600">${esc(String(put))}</text>
  <rect x="72" y="460" width="1056" height="72" rx="8" fill="#1e293b"/>
  <text x="96" y="508" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="26">${product}</text>
  <text x="72" y="600" fill="#64748b" font-family="system-ui,sans-serif" font-size="22">Vector · Helix · Thermal · Largo · Night Hawk · SPX Slayer</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
