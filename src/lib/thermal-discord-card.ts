/**
 * Server-rendered Thermal triple-desk PNG for Discord.
 * Cache-reader inputs only — never fabricates cells. Uses sharp(SVG→PNG)
 * (same pattern as x-desk-card) so ECS needs no browser.
 */
import sharp from "sharp";
import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";

export const THERMAL_DISCORD_TICKERS = ["SPY", "SPX", "QQQ"] as const;
export type ThermalDiscordTicker = (typeof THERMAL_DISCORD_TICKERS)[number];

const POS_RGB = "0,230,118";
const NEG_RGB = "255,45,85";

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

function cellFill(value: number, peak: number): string {
  if (!value || peak <= 0) return "rgba(255,255,255,0.03)";
  const mag = Math.min(1, Math.abs(value) / peak);
  const alpha = (0.08 + Math.pow(mag, 1.35) * 0.82).toFixed(3);
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
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(t));
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
  const W = 1400;
  const H = 780;
  const pad = 28;
  const headerH = 72;
  const colGap = 14;
  const usable = W - pad * 2 - colGap * (columns.length - 1);
  const colW = usable / Math.max(1, columns.length);
  const colTop = pad + headerH;
  const colH = H - colTop - pad;

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
    const call = hm?.gex?.call_wall;
    const put = hm?.gex?.put_wall;
    const expiries = resolveCompactExpiries(hm?.near_term_expiries, hm?.expiries, 8);
    const strikes = bandStrikesAroundSpot(hm?.strikes, spot, 12);
    const cells = hm?.gex?.cells ?? {};
    const peak = peakInWindow(cells, strikes, expiries);

    const headY = colTop + 22;
    colsSvg += `<rect x="${x0}" y="${colTop}" width="${colW}" height="${colH}" rx="10" fill="#08090e" stroke="rgba(34,211,238,0.28)" stroke-width="1.5"/>`;
    colsSvg += `<text x="${x0 + 14}" y="${headY}" fill="#f8fafc" font-family="ui-monospace,Menlo,monospace" font-size="22" font-weight="800" letter-spacing="2">${esc(col.ticker)}</text>`;
    colsSvg += `<text x="${x0 + colW - 14}" y="${headY}" text-anchor="end" fill="#22d3ee" font-family="ui-monospace,Menlo,monospace" font-size="18" font-weight="700">${
      Number.isFinite(spot as number) ? Number(spot).toFixed(2) : "—"
    }</text>`;
    colsSvg += `<text x="${x0 + 14}" y="${headY + 22}" fill="#ffd60a" font-family="ui-monospace,Menlo,monospace" font-size="12" font-weight="700">C ${
      Number.isFinite(call as number) ? Math.round(call as number) : "—"
    }</text>`;
    colsSvg += `<text x="${x0 + 90}" y="${headY + 22}" fill="#e9d5ff" font-family="ui-monospace,Menlo,monospace" font-size="12" font-weight="700">P ${
      Number.isFinite(put as number) ? Math.round(put as number) : "—"
    }</text>`;

    const gridTop = colTop + 58;
    const strikeColW = 42;
    const gridLeft = x0 + 8;
    const gridRight = x0 + colW - 8;
    const gridW = gridRight - gridLeft - strikeColW;
    const expN = Math.max(1, expiries.length);
    const cellW = gridW / expN;
    const rowN = Math.max(1, strikes.length);
    const cellH = Math.min(18, (colH - 70) / rowN);

    if (!hm || expiries.length === 0 || strikes.length === 0) {
      colsSvg += `<text x="${x0 + colW / 2}" y="${colTop + colH / 2}" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace,Menlo,monospace" font-size="13">Matrix unavailable</text>`;
      return;
    }

    expiries.forEach((exp, ei) => {
      const cx = gridLeft + strikeColW + ei * cellW + cellW / 2;
      colsSvg += `<text x="${cx}" y="${gridTop}" text-anchor="middle" fill="#22d3ee" font-family="ui-monospace,Menlo,monospace" font-size="9" font-weight="700">${esc(
        fmtCompactExpiry(exp)
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
      const y = gridTop + 6 + si * cellH;
      const isSpot = si === spotIdx;
      colsSvg += `<text x="${gridLeft + strikeColW - 4}" y="${y + cellH * 0.72}" text-anchor="end" fill="${
        isSpot ? "#22d3ee" : "#f8fafc"
      }" font-family="ui-monospace,Menlo,monospace" font-size="9" font-weight="700">${
        Number.isFinite(strike) ? (strike % 1 === 0 ? String(strike) : strike.toFixed(1)) : "—"
      }</text>`;
      const row = cells[String(strike)] ?? {};
      expiries.forEach((exp, ei) => {
        const v = row[exp];
        const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
        const cx = gridLeft + strikeColW + ei * cellW;
        const fill = cellFill(n, peak);
        colsSvg += `<rect x="${cx + 0.5}" y="${y}" width="${Math.max(1, cellW - 1)}" height="${Math.max(
          1,
          cellH - 1
        )}" fill="${fill}"${isSpot ? ` stroke="rgba(34,211,238,0.55)" stroke-width="0.8"` : ""}/>`;
        if (cellH >= 12 && cellW >= 22) {
          colsSvg += `<text x="${cx + cellW / 2}" y="${y + cellH * 0.72}" text-anchor="middle" fill="#f8fafc" font-family="ui-monospace,Menlo,monospace" font-size="7" font-weight="700">${esc(
            fmtCompactHeatMoney(n)
          )}</text>`;
        }
      });
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a1018"/>
      <stop offset="100%" stop-color="#040407"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="${pad}" y="${pad + 28}" fill="#22d3ee" font-family="ui-monospace,Menlo,monospace" font-size="20" font-weight="800" letter-spacing="4">BLACKOUT THERMAL</text>
  <text x="${pad}" y="${pad + 52}" fill="#7dd3fc" font-family="ui-monospace,Menlo,monospace" font-size="13">SPY · SPX · QQQ · GEX · as of ${esc(
    fmtAsOfEt(asOf)
  )} ET</text>
  <text x="${W - pad}" y="${pad + 28}" text-anchor="end" fill="#7dd3fc" font-family="ui-monospace,Menlo,monospace" font-size="12">live desk snapshot</text>
  ${colsSvg}
</svg>`;
}

export async function renderThermalDiscordCardPng(
  columns: ThermalCardColumn[]
): Promise<Buffer> {
  const svg = buildThermalDiscordCardSvg(columns);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Discord message body — no provider/stack names. */
export function thermalDiscordCaption(columns: ThermalCardColumn[]): string {
  const parts = columns.map((c) => {
    const spot = c.heatmap?.spot;
    const call = c.heatmap?.gex?.call_wall;
    const put = c.heatmap?.gex?.put_wall;
    const spotS = Number.isFinite(spot as number) ? Number(spot).toFixed(2) : "—";
    const cS = Number.isFinite(call as number) ? String(Math.round(call as number)) : "—";
    const pS = Number.isFinite(put as number) ? String(Math.round(put as number)) : "—";
    return `**${c.ticker}** ${spotS} · C ${cS} / P ${pS}`;
  });
  const asOf = columns.map((c) => c.heatmap?.asof).find(Boolean);
  return `Thermal desk · GEX\n${parts.join("\n")}\nas of ${fmtAsOfEt(asOf)} ET`;
}
