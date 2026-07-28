/**
 * Server-rendered Thermal triple-desk PNG for Discord.
 * Cache-reader inputs only — never fabricates cells. Uses sharp(SVG→PNG)
 * (same pattern as x-desk-card) so ECS needs no browser.
 *
 * Target canvas: 3840×2160 (4K UHD) so Discord attachments stay sharp when expanded.
 */
import sharp from "sharp";
import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";

export const THERMAL_DISCORD_TICKERS = ["SPY", "SPX", "QQQ"] as const;
export type ThermalDiscordTicker = (typeof THERMAL_DISCORD_TICKERS)[number];

/** 4K UHD canvas — Discord keeps attachment sharpness when opened full-size. */
export const THERMAL_DISCORD_CARD_W = 3840;
export const THERMAL_DISCORD_CARD_H = 2160;

const POS_RGB = "0,230,118";
const NEG_RGB = "255,45,85";
const FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Compact expiry: YYYY-MM-DD → M/D */
export function fmtCompactExpiry(exp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(exp ?? "").trim());
  if (!m) return String(exp ?? "").slice(0, 5);
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** Desk-style expiry: YYYY-MM-DD → Jul 28 */
export function fmtDeskExpiry(exp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(exp ?? "").trim());
  if (!m) return fmtCompactExpiry(exp);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Number(m[2]) - 1;
  return `${months[mi] ?? m[2]} ${Number(m[3])}`;
}

export function resolveCompactExpiries(
  nearTerm: string[] | undefined | null,
  all: string[] | undefined | null,
  max = 8
): string[] {
  const src =
    Array.isArray(nearTerm) && nearTerm.length > 0
      ? nearTerm
      : Array.isArray(all)
        ? all
        : [];
  return src.slice(0, Math.max(1, max));
}

export function bandStrikesAroundSpot(
  strikes: number[] | undefined | null,
  spot: number | null | undefined,
  halfWidth = 12
): number[] {
  if (!Array.isArray(strikes) || strikes.length === 0) return [];
  if (!Number.isFinite(spot as number)) return strikes.slice(0, halfWidth * 2 + 1);
  const s = Number(spot);
  let nearest = 0;
  let best = Infinity;
  for (let i = 0; i < strikes.length; i++) {
    const d = Math.abs(strikes[i]! - s);
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  const lo = Math.max(0, nearest - halfWidth);
  const hi = Math.min(strikes.length, nearest + halfWidth + 1);
  return strikes.slice(lo, hi);
}

export function fmtCompactHeatMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "·";
  const sign = n > 0 ? "+" : "−";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}K`;
  return `${sign}${Math.round(abs)}`;
}

function fmtSpot(n: number | null | undefined): string {
  if (!Number.isFinite(n as number)) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtLevel(n: number | null | undefined): string {
  if (!Number.isFinite(n as number)) return "—";
  return Math.round(n as number).toLocaleString("en-US");
}

function fmtChangePct(n: number | null | undefined): { text: string; color: string } {
  if (!Number.isFinite(n as number)) return { text: "—", color: "#7dd3fc" };
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return {
    text: `${sign}${v.toFixed(2)}%`,
    color: v >= 0 ? "#00e676" : "#ff2d55",
  };
}

function cellFill(value: number, peak: number): string {
  if (!value || peak <= 0) return "rgba(255,255,255,0.035)";
  const mag = Math.min(1, Math.abs(value) / peak);
  const alpha = (0.1 + Math.pow(mag, 1.35) * 0.85).toFixed(3);
  const rgb = value > 0 ? POS_RGB : NEG_RGB;
  return `rgba(${rgb},${alpha})`;
}

function peakInWindow(
  cells: Record<string, Record<string, number>>,
  strikes: number[],
  expiries: string[]
): number {
  let peak = 0;
  for (const s of strikes) {
    const row = cells[String(s)];
    if (!row) continue;
    for (const e of expiries) {
      const v = row[e];
      if (typeof v === "number" && Number.isFinite(v)) {
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
    }
  }
  return peak;
}

function fmtAsOfEt(iso: string | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(t));
}

/** Rounded chip (label + value) for column meta. */
function chip(
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  tone: "call" | "put" | "flip" | "neutral"
): string {
  const fill =
    tone === "call"
      ? "rgba(255,214,10,0.12)"
      : tone === "put"
        ? "rgba(217,123,255,0.14)"
        : tone === "flip"
          ? "rgba(34,211,238,0.12)"
          : "rgba(125,211,252,0.08)";
  const stroke =
    tone === "call"
      ? "rgba(255,214,10,0.45)"
      : tone === "put"
        ? "rgba(217,123,255,0.5)"
        : tone === "flip"
          ? "rgba(34,211,238,0.45)"
          : "rgba(125,211,252,0.28)";
  const labelColor =
    tone === "call" ? "#ffd60a" : tone === "put" ? "#e9d5ff" : tone === "flip" ? "#22d3ee" : "#7dd3fc";
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>` +
    `<text x="${x + 18}" y="${y + h * 0.62}" fill="${labelColor}" font-family="${FONT}" font-size="18" font-weight="700" letter-spacing="1">${esc(label)}</text>` +
    `<text x="${x + w - 18}" y="${y + h * 0.64}" text-anchor="end" fill="#f8fafc" font-family="${FONT}" font-size="22" font-weight="800">${esc(value)}</text>`
  );
}

export type ThermalCardColumn = {
  ticker: string;
  heatmap: GexHeatmap | null;
};

/** Build SVG markup for unit tests / debugging (no sharp). */
export function buildThermalDiscordCardSvg(
  columns: ThermalCardColumn[],
  opts?: { asOfLabel?: string }
): string {
  const W = THERMAL_DISCORD_CARD_W;
  const H = THERMAL_DISCORD_CARD_H;
  const pad = 48;
  const headerH = 140;
  const footerH = 72;
  const colGap = 28;
  const usable = W - pad * 2 - colGap * (columns.length - 1);
  const colW = usable / Math.max(1, columns.length);
  const colTop = pad + headerH;
  const colH = H - colTop - pad - footerH;

  const asOf =
    opts?.asOfLabel ??
    columns
      .map((c) => c.heatmap?.asof)
      .find((x) => Boolean(x));

  let colsSvg = "";
  columns.forEach((col, i) => {
    const x0 = pad + i * (colW + colGap);
    const hm = col.heatmap;
    const spot = hm?.spot;
    const chg = fmtChangePct(hm?.change_pct);
    const call = hm?.gex?.call_wall;
    const put = hm?.gex?.put_wall;
    const flip = hm?.gex?.flip;
    const expiries = resolveCompactExpiries(hm?.near_term_expiries, hm?.expiries, 8);
    const strikes = bandStrikesAroundSpot(hm?.strikes, spot, 12);
    const cells = hm?.gex?.cells ?? {};
    const peak = peakInWindow(cells, strikes, expiries);

    // Column shell
    colsSvg += `<rect x="${x0}" y="${colTop}" width="${colW}" height="${colH}" rx="20" fill="#08090e" stroke="rgba(34,211,238,0.32)" stroke-width="2"/>`;
    colsSvg += `<rect x="${x0}" y="${colTop}" width="${colW}" height="118" rx="20" fill="rgba(34,211,238,0.06)"/>`;
    colsSvg += `<rect x="${x0}" y="${colTop + 98}" width="${colW}" height="20" fill="#08090e"/>`;

    // Ticker badge
    const badgeW = 110;
    colsSvg += `<rect x="${x0 + 24}" y="${colTop + 22}" width="${badgeW}" height="40" rx="10" fill="rgba(34,211,238,0.16)" stroke="rgba(34,211,238,0.5)" stroke-width="1.5"/>`;
    colsSvg += `<text x="${x0 + 24 + badgeW / 2}" y="${colTop + 50}" text-anchor="middle" fill="#22d3ee" font-family="${FONT}" font-size="26" font-weight="800" letter-spacing="3">${esc(col.ticker)}</text>`;

    // Spot + change
    colsSvg += `<text x="${x0 + 24 + badgeW + 20}" y="${colTop + 52}" fill="#f8fafc" font-family="${FONT}" font-size="36" font-weight="800">${esc(fmtSpot(spot))}</text>`;
    colsSvg += `<text x="${x0 + colW - 28}" y="${colTop + 50}" text-anchor="end" fill="${chg.color}" font-family="${FONT}" font-size="24" font-weight="800">${esc(chg.text)}</text>`;

    // Level chips
    const chipY = colTop + 74;
    const chipH = 36;
    const chipGap = 10;
    const chipW = (colW - 48 - chipGap * 2) / 3;
    colsSvg += chip(x0 + 24, chipY, chipW, chipH, "CALL WALL", fmtLevel(call), "call");
    colsSvg += chip(x0 + 24 + chipW + chipGap, chipY, chipW, chipH, "PUT WALL", fmtLevel(put), "put");
    colsSvg += chip(x0 + 24 + (chipW + chipGap) * 2, chipY, chipW, chipH, "FLIP", fmtLevel(flip), "flip");

    const gridTop = colTop + 128;
    const strikeColW = 88;
    const gridLeft = x0 + 16;
    const gridRight = x0 + colW - 16;
    const gridW = gridRight - gridLeft - strikeColW;
    const expN = Math.max(1, expiries.length);
    const cellW = gridW / expN;
    const rowN = Math.max(1, strikes.length);
    const cellH = Math.min(52, (colH - 150) / rowN);
    const labelSize = Math.max(14, Math.min(20, cellH * 0.42));
    const strikeSize = Math.max(16, Math.min(22, cellH * 0.48));
    const expSize = 16;

    if (!hm || expiries.length === 0 || strikes.length === 0) {
      colsSvg += `<text x="${x0 + colW / 2}" y="${colTop + colH / 2}" text-anchor="middle" fill="#7dd3fc" font-family="${FONT}" font-size="28" font-weight="700">Matrix unavailable</text>`;
      colsSvg += `<text x="${x0 + colW / 2}" y="${colTop + colH / 2 + 36}" text-anchor="middle" fill="#7dd3fc" font-family="${FONT}" font-size="18">Waiting for live chain snapshot</text>`;
      return;
    }

    // Corner label
    colsSvg += `<text x="${gridLeft + strikeColW - 8}" y="${gridTop}" text-anchor="end" fill="#7dd3fc" font-family="${FONT}" font-size="14" font-weight="700" letter-spacing="1">STRIKE</text>`;

    expiries.forEach((exp, ei) => {
      const cx = gridLeft + strikeColW + ei * cellW + cellW / 2;
      colsSvg += `<text x="${cx}" y="${gridTop}" text-anchor="middle" fill="#22d3ee" font-family="${FONT}" font-size="${expSize}" font-weight="800">${esc(
        fmtDeskExpiry(exp)
      )}</text>`;
    });

    let spotIdx = -1;
    if (Number.isFinite(spot as number)) {
      let best = Infinity;
      strikes.forEach((s, si) => {
        const d = Math.abs(s - Number(spot));
        if (d < best) {
          best = d;
          spotIdx = si;
        }
      });
    }

    strikes.forEach((strike, si) => {
      const y = gridTop + 12 + si * cellH;
      const isSpot = si === spotIdx;
      if (isSpot) {
        colsSvg += `<rect x="${gridLeft}" y="${y}" width="${gridRight - gridLeft}" height="${cellH}" fill="rgba(34,211,238,0.07)"/>`;
      }
      colsSvg += `<text x="${gridLeft + strikeColW - 10}" y="${y + cellH * 0.68}" text-anchor="end" fill="${
        isSpot ? "#22d3ee" : "#f8fafc"
      }" font-family="${FONT}" font-size="${strikeSize}" font-weight="800">${
        Number.isFinite(strike)
          ? strike.toLocaleString("en-US", {
              maximumFractionDigits: strike % 1 === 0 ? 0 : 1,
            })
          : "—"
      }</text>`;
      const row = cells[String(strike)] ?? {};
      expiries.forEach((exp, ei) => {
        const v = row[exp];
        const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
        const cx = gridLeft + strikeColW + ei * cellW;
        const fill = cellFill(n, peak);
        colsSvg += `<rect x="${cx + 1}" y="${y + 1}" width="${Math.max(1, cellW - 2)}" height="${Math.max(
          1,
          cellH - 2
        )}" rx="3" fill="${fill}"${isSpot ? ` stroke="rgba(34,211,238,0.65)" stroke-width="1.5"` : ""}/>`;
        if (cellH >= 28 && cellW >= 48) {
          colsSvg += `<text x="${cx + cellW / 2}" y="${y + cellH * 0.68}" text-anchor="middle" fill="#f8fafc" font-family="${FONT}" font-size="${labelSize}" font-weight="800">${esc(
            fmtCompactHeatMoney(n)
          )}</text>`;
        }
      });
    });
  });

  const asOfText = fmtAsOfEt(asOf);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a121c"/>
      <stop offset="55%" stop-color="#040407"/>
      <stop offset="100%" stop-color="#070b12"/>
    </linearGradient>
    <linearGradient id="scan" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(34,211,238,0.08)"/>
      <stop offset="100%" stop-color="rgba(34,211,238,0)"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="${headerH + pad}" fill="url(#scan)"/>

  <text x="${pad}" y="${pad + 42}" fill="#22d3ee" font-family="${FONT}" font-size="42" font-weight="800" letter-spacing="6">BLACKOUT THERMAL</text>
  <text x="${pad}" y="${pad + 88}" fill="#7dd3fc" font-family="${FONT}" font-size="24" font-weight="600">SPY  ·  SPX  ·  QQQ   ·   Net dealer gamma (GEX)</text>

  <rect x="${W - pad - 520}" y="${pad + 18}" width="240" height="44" rx="22" fill="rgba(34,211,238,0.12)" stroke="rgba(34,211,238,0.45)" stroke-width="1.5"/>
  <text x="${W - pad - 400}" y="${pad + 48}" text-anchor="middle" fill="#22d3ee" font-family="${FONT}" font-size="20" font-weight="800" letter-spacing="2">LENS  GEX</text>

  <rect x="${W - pad - 260}" y="${pad + 18}" width="260" height="44" rx="22" fill="rgba(0,230,118,0.1)" stroke="rgba(0,230,118,0.4)" stroke-width="1.5"/>
  <circle cx="${W - pad - 230}" cy="${pad + 40}" r="6" fill="#00e676"/>
  <text x="${W - pad - 120}" y="${pad + 48}" text-anchor="middle" fill="#00e676" font-family="${FONT}" font-size="18" font-weight="800" letter-spacing="1">LIVE SNAPSHOT</text>

  <text x="${W - pad}" y="${pad + 100}" text-anchor="end" fill="#7dd3fc" font-family="${FONT}" font-size="22" font-weight="700">as of ${esc(asOfText)} ET</text>

  ${colsSvg}

  <rect x="${pad}" y="${H - pad - footerH + 8}" width="${W - pad * 2}" height="${footerH - 8}" rx="14" fill="rgba(8,9,14,0.85)" stroke="rgba(125,211,252,0.18)" stroke-width="1"/>
  <rect x="${pad + 28}" y="${H - pad - footerH + 28}" width="18" height="18" rx="3" fill="rgba(0,230,118,0.75)"/>
  <text x="${pad + 56}" y="${H - pad - footerH + 44}" fill="#f8fafc" font-family="${FONT}" font-size="20" font-weight="700">+GEX  dealers long gamma</text>
  <rect x="${pad + 360}" y="${H - pad - footerH + 28}" width="18" height="18" rx="3" fill="rgba(255,45,85,0.75)"/>
  <text x="${pad + 388}" y="${H - pad - footerH + 44}" fill="#f8fafc" font-family="${FONT}" font-size="20" font-weight="700">−GEX  dealers short gamma</text>
  <text x="${W - pad - 28}" y="${H - pad - footerH + 44}" text-anchor="end" fill="#7dd3fc" font-family="${FONT}" font-size="18" font-weight="600">Cyan row = spot  ·  Near-term expiries only  ·  4K desk card</text>
</svg>`;
}

export async function renderThermalDiscordCardPng(
  columns: ThermalCardColumn[]
): Promise<Buffer> {
  const svg = buildThermalDiscordCardSvg(columns);
  // PNG at native 4K; slight compression keeps Discord uploads under typical limits.
  return sharp(Buffer.from(svg), { density: 144 })
    .png({ compressionLevel: 7, adaptiveFiltering: true })
    .toBuffer();
}

/** Discord message body — no provider/stack names. */
export function thermalDiscordCaption(columns: ThermalCardColumn[]): string {
  const parts = columns.map((c) => {
    const spot = c.heatmap?.spot;
    const call = c.heatmap?.gex?.call_wall;
    const put = c.heatmap?.gex?.put_wall;
    const flip = c.heatmap?.gex?.flip;
    const chg = c.heatmap?.change_pct;
    const spotS = fmtSpot(spot);
    const chgS =
      Number.isFinite(chg as number)
        ? ` (${Number(chg) >= 0 ? "+" : ""}${Number(chg).toFixed(2)}%)`
        : "";
    return (
      `**${c.ticker}**  \`${spotS}\`${chgS}\n` +
      `Call wall \`${fmtLevel(call)}\` · Put wall \`${fmtLevel(put)}\` · Flip \`${fmtLevel(flip)}\``
    );
  });
  const asOf = columns.map((c) => c.heatmap?.asof).find(Boolean);
  return `**Thermal desk · GEX** · 4K\n${parts.join("\n")}\nas of ${fmtAsOfEt(asOf)} ET`;
}
