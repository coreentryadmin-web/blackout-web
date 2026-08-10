/**
 * Server-rendered Thermal triple-desk PNG for Discord.
 * Cache-reader inputs only — never fabricates cells. Uses sharp(SVG→PNG)
 * (same pattern as x-desk-card) so ECS needs no browser.
 *
 * Target canvas: 3840×2160 (4K UHD) so Discord attachments stay sharp when expanded.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";

export const THERMAL_DISCORD_TICKERS = ["SPY", "SPX", "QQQ"] as const;
export type ThermalDiscordTicker = (typeof THERMAL_DISCORD_TICKERS)[number];

/** 4K UHD canvas — Discord keeps attachment sharpness when opened full-size. */
export const THERMAL_DISCORD_CARD_W = 3840;
export const THERMAL_DISCORD_CARD_H = 2160;

/** Five near-term session days per ticker (SPY|SPX|QQQ) — tight, close cells. */
export const THERMAL_DISCORD_MAX_EXPIRIES = 5;
/** Spot-centered strike band — dense ladder, cells stay readable at 4K. */
export const THERMAL_DISCORD_STRIKE_HALF = 16;

const POS_RGB = "0,230,118";
const NEG_RGB = "255,45,85";
/** Call / + node bead — same yellow as major Thermal matrix. */
const PLUS_NODE_RGB = "255,214,10";
/** Put / − node bead — same purple as major Thermal matrix. */
const MINUS_NODE_RGB = "217,123,255";
/**
 * Embedded face name (see `deskMonoFontFaceCss`). System DejaVu is fallback only —
 * cron on ECS used to paint tofu boxes when fontconfig had nothing to resolve.
 */
const FONT = "BlackOutDeskMono, DejaVu Sans Mono, monospace";

let cachedFontFaceCss: string | null = null;

/** Paths for bundled TTFs (repo + Docker `/app/deploy/fonts` + system). */
export function deskMonoFontCandidates(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "deploy/fonts/DejaVuSansMono-Bold.ttf"),
    path.join(cwd, "deploy/fonts/DejaVuSansMono.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  ];
}

/**
 * `@font-face` block with base64 TTF.
 *
 * CAVEAT, measured 2026-08-10: librsvg (sharp's SVG backend) resolves fonts through fontconfig
 * and IGNORES an `@font-face` data URI — proven by rendering two different faces through it in
 * one SVG and getting the same glyphs back. So this block is NOT what makes the card render; the
 * `DejaVu Sans Mono` fallback in `FONT` is, via the TTFs `deploy/fonts` puts on disk for
 * fontconfig. That is harmless HERE because the embedded face IS DejaVu — the card looks the way
 * it is supposed to either way. It would NOT be harmless with a brand face: the X autopost desk
 * card asked for `system-ui` through this same path and silently rendered DejaVu for its whole
 * life, which is why `src/lib/x-desk-card.tsx` now rasterises through satori (font BUFFERS, no
 * fontconfig). Do not add a brand face to this file expecting it to appear.
 */
export function deskMonoFontFaceCss(): string {
  if (cachedFontFaceCss != null) return cachedFontFaceCss;
  for (const file of deskMonoFontCandidates()) {
    if (!existsSync(file)) continue;
    try {
      const b64 = readFileSync(file).toString("base64");
      cachedFontFaceCss =
        `@font-face{font-family:'BlackOutDeskMono';src:url('data:font/ttf;base64,${b64}') format('truetype');` +
        `font-weight:100 900;font-style:normal}`;
      return cachedFontFaceCss;
    } catch {
      // try next candidate
    }
  }
  cachedFontFaceCss = "";
  return cachedFontFaceCss;
}

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

/** Single 0DTE expiry for Discord heat strips — today ET if on axis, else earliest. */
export function resolveDiscordZeroDteExpiry(
  nearTerm: string[] | undefined | null,
  all: string[] | undefined | null,
  todayYmd?: string | null
): string | null {
  const axis = resolveCompactExpiries(nearTerm, all, 64);
  if (axis.length === 0) return null;
  const today =
    typeof todayYmd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(todayYmd) ? todayYmd : null;
  if (today && axis.includes(today)) return today;
  return axis[0] ?? null;
}

/** True when the expiry column has any nonzero GEX in the strike window. */
export function expiryHasGexData(
  cells: Record<string, Record<string, number>> | undefined,
  strikes: number[],
  expiry: string
): boolean {
  if (!cells || !expiry) return false;
  for (const s of strikes) {
    const v = cells[String(s)]?.[expiry];
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) return true;
  }
  return false;
}

/**
 * Desk expiry for Discord: prefer today's 0DTE when it still has live GEX cells;
 * after the close (settled/empty 0DTE) fall forward to the nearest near-term expiry
 * that still carries nonzero exposure — never paint a blank strip of zeros.
 */
export function resolveDiscordDeskExpiry(
  cells: Record<string, Record<string, number>> | undefined,
  strikes: number[],
  nearTerm: string[] | undefined | null,
  all: string[] | undefined | null,
  todayYmd?: string | null
): string | null {
  const axis = resolveCompactExpiries(nearTerm, all, 64);
  if (axis.length === 0) return null;
  const today =
    typeof todayYmd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(todayYmd) ? todayYmd : null;
  if (today && axis.includes(today) && expiryHasGexData(cells, strikes, today)) return today;
  for (const e of axis) {
    if (expiryHasGexData(cells, strikes, e)) return e;
  }
  // Structure fallback (honest empty cells) — today if listed, else earliest.
  if (today && axis.includes(today)) return today;
  return axis[0] ?? null;
}

/**
 * Near-term expiry axis for Discord — SPX Slayer–style tight rail.
 * Skips settled empty today-0DTE so the matrix never opens with a blank column.
 */
export function resolveDiscordNearExpiries(
  cells: Record<string, Record<string, number>> | undefined,
  strikes: number[],
  nearTerm: string[] | undefined | null,
  all: string[] | undefined | null,
  todayYmd?: string | null,
  max = THERMAL_DISCORD_MAX_EXPIRIES
): string[] {
  const axis = resolveCompactExpiries(nearTerm, all, 64);
  if (axis.length === 0) return [];
  const today =
    typeof todayYmd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(todayYmd) ? todayYmd : null;
  const capped = Math.max(1, max);
  const out: string[] = [];
  for (const e of axis) {
    if (out.length >= capped) break;
    if (today && e === today && !expiryHasGexData(cells, strikes, e)) continue;
    out.push(e);
  }
  // If everything was empty (rare), fall back to structure so the frame still renders.
  if (out.length === 0) return axis.slice(0, capped);
  return out;
}

function todayEtYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
  if (!Number.isFinite(n) || n === 0) return "$0.0K";
  // ASCII hyphen-minus — avoids missing-glyph tofu if a face lacks U+2212.
  const sign = n > 0 ? "+" : "-";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `${sign}$${k < 10 ? k.toFixed(1) : Math.round(k)}K`;
  }
  return `${sign}$${Math.round(abs)}`;
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
    color: v >= 0 ? "#a3e635" : "#ff2d55",
  };
}

function cellFill(value: number, peak: number): string {
  if (!value || peak <= 0) return "rgba(255,255,255,0.035)";
  const mag = Math.min(1, Math.abs(value) / peak);
  const alpha = (0.1 + Math.pow(mag, 1.35) * 0.85).toFixed(3);
  const rgb = value > 0 ? POS_RGB : NEG_RGB;
  return `rgba(${rgb},${alpha})`;
}

function plusNodeFill(): string {
  // Keep translucent so $ labels stay readable on top (never opaque "boxes").
  return `rgba(${PLUS_NODE_RGB},0.42)`;
}

function minusNodeFill(): string {
  return `rgba(${MINUS_NODE_RGB},0.40)`;
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

export type DiscordDayExtremes = {
  callWall: number | null;
  putWall: number | null;
  king: number | null;
};

const EXPIRY_YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Per-expiry +node / −node / king — ascending-strike strict tie-break (lowest wins). */
export function discordPerExpiryExtremes(
  cells: Record<string, Record<string, number>>,
  strikes: number[],
  expiries: string[]
): Record<string, DiscordDayExtremes> {
  const out: Record<string, DiscordDayExtremes> = Object.create(null);
  const strikesAsc = [...strikes].sort((a, b) => a - b);
  for (const raw of expiries) {
    // Fail-closed key gate — only YYYY-MM-DD expiry axes become object keys (CodeQL).
    const e = typeof raw === "string" && EXPIRY_YMD.test(raw) ? raw : null;
    if (!e) continue;
    let callWall: number | null = null;
    let putWall: number | null = null;
    let king: number | null = null;
    let posMax = 0;
    let negMin = 0;
    let bestMag = 0;
    for (const sNum of strikesAsc) {
      const v = cells[String(sNum)]?.[e];
      if (typeof v !== "number" || !Number.isFinite(v) || v === 0) continue;
      if (v > posMax) {
        posMax = v;
        callWall = sNum;
      } else if (v < negMin) {
        negMin = v;
        putWall = sNum;
      }
      const mag = Math.abs(v);
      if (mag > bestMag) {
        bestMag = mag;
        king = sNum;
      }
    }
    out[e] = { callWall, putWall, king };
  }
  return out;
}

/**
 * Intraday % drift for a strike (build/melt) — mirrors `shiftPercentForStrike`
 * (baseline = current − delta; sign follows delta; null when unavailable).
 */
export function discordDriftPct(
  currentValue: number,
  delta: number | null | undefined
): number | null {
  if (delta == null || !Number.isFinite(delta) || !Number.isFinite(currentValue)) return null;
  const baseline = currentValue - delta;
  if (!Number.isFinite(baseline) || Math.abs(baseline) < 1) return null;
  return (delta / Math.abs(baseline)) * 100;
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
  const pad = 36;
  const headerH = 140;
  const footerH = 72;
  // Tight gaps so SPY|SPX|QQQ sit close with room for 5 expiry cells each.
  const colGap = 16;
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
    // SPX Slayer–style tight near-term matrix: strike × expiry columns.
    // Skip settled empty today-0DTE so the rail never opens with a blank day.
    const today = todayEtYmd();
    const cells = hm?.gex?.cells ?? {};
    const strikes = bandStrikesAroundSpot(hm?.strikes, spot, THERMAL_DISCORD_STRIKE_HALF);
    const expiries = resolveDiscordNearExpiries(
      cells,
      strikes,
      hm?.near_term_expiries,
      hm?.expiries,
      today,
      THERMAL_DISCORD_MAX_EXPIRIES
    );
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
    colsSvg += `<text x="${x0 + colW - 28}" y="${colTop + 50}" text-anchor="end" fill="${chg.color}" font-family="${FONT}" font-size="26" font-weight="800">${esc(chg.text)}</text>`;

    // Level chips
    const chipY = colTop + 74;
    const chipH = 36;
    const chipGap = 10;
    const chipW = (colW - 48 - chipGap * 2) / 3;
    colsSvg += chip(x0 + 24, chipY, chipW, chipH, "CALL WALL", fmtLevel(call), "call");
    colsSvg += chip(x0 + 24 + chipW + chipGap, chipY, chipW, chipH, "PUT WALL", fmtLevel(put), "put");
    colsSvg += chip(x0 + 24 + (chipW + chipGap) * 2, chipY, chipW, chipH, "FLIP", fmtLevel(flip), "flip");

    const gridTop = colTop + 128;
    // Thin strike + DR% — maximize width for 5 close expiry cells.
    const strikeColW = 82;
    const driftColW = 48;
    const gridLeft = x0 + 10;
    const gridRight = x0 + colW - 10;
    const gridW = Math.max(120, gridRight - gridLeft - strikeColW - driftColW);
    const expN = Math.max(1, expiries.length);
    const cellW = gridW / expN;
    const rowN = Math.max(1, strikes.length);
    const cellH = Math.min(48, (colH - 150) / rowN);
    const labelSize = Math.max(11, Math.min(17, Math.min(cellH * 0.42, cellW * 0.18)));
    const strikeSize = Math.max(13, Math.min(19, cellH * 0.48));
    const driftSize = Math.max(10, Math.min(14, cellH * 0.4));
    const expSize = Math.max(11, Math.min(15, cellW * 0.15));
    const showCellText = cellH >= 22 && cellW >= 44;

    if (!hm || expiries.length === 0 || strikes.length === 0) {
      colsSvg += `<text x="${x0 + colW / 2}" y="${colTop + colH / 2}" text-anchor="middle" fill="#7dd3fc" font-family="${FONT}" font-size="28" font-weight="700">Matrix unavailable</text>`;
      colsSvg += `<text x="${x0 + colW / 2}" y="${colTop + colH / 2 + 36}" text-anchor="middle" fill="#7dd3fc" font-family="${FONT}" font-size="18">Waiting for live chain snapshot</text>`;
      return;
    }

    const extremes = discordPerExpiryExtremes(cells, strikes, expiries);
    const shift = hm.shift;
    const strikeTotals = hm.gex?.strike_totals ?? {};
    const driftAvailable = Boolean(shift?.available && shift.delta_by_strike);

    // Corner + expiry headers (0DTE chip when today's live column is present)
    colsSvg += `<text x="${gridLeft + strikeColW - 6}" y="${gridTop}" text-anchor="end" fill="#7dd3fc" font-family="${FONT}" font-size="13" font-weight="800" letter-spacing="1">STRIKE</text>`;
    colsSvg += `<text x="${gridLeft + strikeColW + driftColW / 2}" y="${gridTop}" text-anchor="middle" fill="#7dd3fc" font-family="${FONT}" font-size="12" font-weight="800" letter-spacing="1">DR%</text>`;
    expiries.forEach((exp, ei) => {
      const cx = gridLeft + strikeColW + driftColW + ei * cellW + cellW / 2;
      const is0 = exp === today;
      if (is0) {
        colsSvg += `<text x="${cx}" y="${gridTop - 14}" text-anchor="middle" fill="#22d3ee" font-family="${FONT}" font-size="11" font-weight="800" letter-spacing="1">0DTE</text>`;
      }
      colsSvg += `<text x="${cx}" y="${gridTop}" text-anchor="middle" fill="${is0 ? "#22d3ee" : "#7dd3fc"}" font-family="${FONT}" font-size="${expSize}" font-weight="800">${esc(
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
      const y = gridTop + 12 + si * cellH;
      const isSpot = si === spotIdx;
      const callWallN = Number.isFinite(call as number) ? Number(call) : null;
      const putWallN = Number.isFinite(put as number) ? Number(put) : null;
      const isCallRow = callWallN != null && strike === callWallN;
      const isPutRow = putWallN != null && strike === putWallN;
      // Full-row wall / spot washes — matches the dense triple-desk look you liked.
      if (isCallRow) {
        colsSvg += `<rect x="${gridLeft}" y="${y}" width="${gridRight - gridLeft}" height="${cellH}" fill="rgba(${PLUS_NODE_RGB},0.16)"/>`;
      } else if (isPutRow) {
        colsSvg += `<rect x="${gridLeft}" y="${y}" width="${gridRight - gridLeft}" height="${cellH}" fill="rgba(${MINUS_NODE_RGB},0.16)"/>`;
      } else if (isSpot) {
        colsSvg += `<rect x="${gridLeft}" y="${y}" width="${gridRight - gridLeft}" height="${cellH}" fill="rgba(34,211,238,0.09)"/>`;
      }
      const strikeFill = isCallRow ? "#ffd60a" : isPutRow ? "#e9d5ff" : isSpot ? "#22d3ee" : "#f8fafc";
      colsSvg += `<text x="${gridLeft + strikeColW - 8}" y="${y + cellH * 0.68}" text-anchor="end" fill="${strikeFill}" font-family="${FONT}" font-size="${strikeSize}" font-weight="800">${
        Number.isFinite(strike)
          ? strike.toLocaleString("en-US", {
              maximumFractionDigits: strike % 1 === 0 ? 0 : 1,
            })
          : "—"
      }</text>`;

      const totalNow = strikeTotals[String(strike)];
      const currentTotal =
        typeof totalNow === "number" && Number.isFinite(totalNow) ? totalNow : 0;
      const delta = driftAvailable ? shift!.delta_by_strike?.[String(strike)] : null;
      const driftPct = discordDriftPct(currentTotal, delta);
      const driftX = gridLeft + strikeColW + driftColW / 2;
      if (driftPct == null) {
        colsSvg += `<text x="${driftX}" y="${y + cellH * 0.68}" text-anchor="middle" fill="#7dd3fc" font-family="${FONT}" font-size="${driftSize}" font-weight="700">·</text>`;
      } else {
        const driftColor = driftPct >= 0 ? "#a3e635" : "#ff2d55";
        const driftText = `${driftPct >= 0 ? "+" : ""}${Math.round(driftPct)}%`;
        colsSvg += `<text x="${driftX}" y="${y + cellH * 0.68}" text-anchor="middle" fill="${driftColor}" font-family="${FONT}" font-size="${driftSize}" font-weight="800">${esc(driftText)}</text>`;
      }

      const row = cells[String(strike)] ?? {};
      expiries.forEach((exp, ei) => {
        const v = row[exp];
        const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
        const cx = gridLeft + strikeColW + driftColW + ei * cellW;
        const day = extremes[exp];
        const isPlusNode = day?.callWall === strike && n > 0;
        const isMinusNode = day?.putWall === strike && n < 0;
        const isKing = day?.king === strike && n !== 0;
        const fill = isPlusNode
          ? plusNodeFill()
          : isMinusNode
            ? minusNodeFill()
            : cellFill(n, peak);
        const stroke = isPlusNode
          ? ` stroke="rgba(${PLUS_NODE_RGB},0.95)" stroke-width="2"`
          : isMinusNode
            ? ` stroke="rgba(${MINUS_NODE_RGB},0.95)" stroke-width="2"`
            : isSpot
              ? ` stroke="rgba(34,211,238,0.65)" stroke-width="1.5"`
              : "";
        // Flush cells (0.5px gap) — "close cells" dense desk look.
        colsSvg += `<rect x="${cx + 0.5}" y="${y + 0.5}" width="${Math.max(1, cellW - 1)}" height="${Math.max(
          1,
          cellH - 1
        )}" rx="2" fill="${fill}"${stroke}/>`;
        if (showCellText) {
          // Signed green/red money — same read as the dense desk screenshot.
          const textFill = isPlusNode
            ? "#fffbeb"
            : isMinusNode
              ? "#faf5ff"
              : n > 0
                ? "#00e676"
                : n < 0
                  ? "#ff2d55"
                  : "#7dd3fc";
          const label = isKing ? `${fmtCompactHeatMoney(n)}*` : fmtCompactHeatMoney(n);
          colsSvg += `<text x="${cx + cellW / 2}" y="${y + cellH * 0.68}" text-anchor="middle" fill="${textFill}" font-family="${FONT}" font-size="${labelSize}" font-weight="800">${esc(
            label
          )}</text>`;
        }
      });
    });
  });

  const asOfText = fmtAsOfEt(asOf);

  const fontFace = deskMonoFontFaceCss();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${fontFace ? `<style type="text/css"><![CDATA[${fontFace}]]></style>` : ""}
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
  <text x="${pad}" y="${pad + 88}" fill="#7dd3fc" font-family="${FONT}" font-size="24" font-weight="600">SPY  ·  SPX  ·  QQQ   ·   near-term GEX matrix   ·   DR% = build/melt</text>

  <rect x="${W - pad - 520}" y="${pad + 18}" width="240" height="44" rx="22" fill="rgba(34,211,238,0.12)" stroke="rgba(34,211,238,0.45)" stroke-width="1.5"/>
  <text x="${W - pad - 400}" y="${pad + 48}" text-anchor="middle" fill="#22d3ee" font-family="${FONT}" font-size="20" font-weight="800" letter-spacing="2">LENS  GEX</text>

  <rect x="${W - pad - 260}" y="${pad + 18}" width="260" height="44" rx="22" fill="rgba(0,230,118,0.1)" stroke="rgba(0,230,118,0.4)" stroke-width="1.5"/>
  <circle cx="${W - pad - 230}" cy="${pad + 40}" r="6" fill="#a3e635"/>
  <text x="${W - pad - 120}" y="${pad + 48}" text-anchor="middle" fill="#a3e635" font-family="${FONT}" font-size="18" font-weight="800" letter-spacing="1">LIVE SNAPSHOT</text>

  <text x="${W - pad}" y="${pad + 100}" text-anchor="end" fill="#7dd3fc" font-family="${FONT}" font-size="22" font-weight="700">as of ${esc(asOfText)} ET</text>

  ${colsSvg}

  <rect x="${pad}" y="${H - pad - footerH + 8}" width="${W - pad * 2}" height="${footerH - 8}" rx="14" fill="rgba(8,9,14,0.85)" stroke="rgba(125,211,252,0.18)" stroke-width="1"/>
  <rect x="${pad + 28}" y="${H - pad - footerH + 28}" width="18" height="18" rx="3" fill="rgba(0,230,118,0.75)"/>
  <text x="${pad + 56}" y="${H - pad - footerH + 44}" fill="#f8fafc" font-family="${FONT}" font-size="18" font-weight="700">+GEX</text>
  <rect x="${pad + 130}" y="${H - pad - footerH + 28}" width="18" height="18" rx="3" fill="rgba(255,45,85,0.75)"/>
  <text x="${pad + 158}" y="${H - pad - footerH + 44}" fill="#f8fafc" font-family="${FONT}" font-size="18" font-weight="700">-GEX</text>
  <rect x="${pad + 240}" y="${H - pad - footerH + 28}" width="18" height="18" rx="3" fill="rgba(${PLUS_NODE_RGB},0.85)"/>
  <text x="${pad + 268}" y="${H - pad - footerH + 44}" fill="#ffd60a" font-family="${FONT}" font-size="18" font-weight="700">PLUS node (yellow)</text>
  <rect x="${pad + 500}" y="${H - pad - footerH + 28}" width="18" height="18" rx="3" fill="rgba(${MINUS_NODE_RGB},0.85)"/>
  <text x="${pad + 528}" y="${H - pad - footerH + 44}" fill="#e9d5ff" font-family="${FONT}" font-size="18" font-weight="700">MINUS node (purple)</text>
  <text x="${pad + 780}" y="${H - pad - footerH + 44}" fill="#fbbf24" font-family="${FONT}" font-size="18" font-weight="700">* = king |GEX|</text>
  <text x="${W - pad - 28}" y="${H - pad - footerH + 44}" text-anchor="end" fill="#7dd3fc" font-family="${FONT}" font-size="17" font-weight="600">Cyan row = spot  ·  ${THERMAL_DISCORD_MAX_EXPIRIES} near expiries  ·  4K</text>
</svg>`;
}

/** Caption mode for multi-expiry near-term rail. */
export function thermalDiscordCaptionMode(_columns: ThermalCardColumn[]): "NEAR" {
  return "NEAR";
}

export async function renderThermalDiscordCardPng(
  columns: ThermalCardColumn[]
): Promise<Buffer> {
  const svg = buildThermalDiscordCardSvg(columns);
  // Native 3840×2160 — do NOT raise `density` (default 72). density:144 doubles
  // pixels to 7680×4320 and Discord stops inline-previewing (>~4096px → file download).
  return sharp(Buffer.from(svg))
    .png({ compressionLevel: 7, adaptiveFiltering: true })
    .toBuffer();
}

/** @deprecated Use `buildThermalDiscordEmbed` — legacy plain-text caption kept for reference. */
export function thermalDiscordCaption(columns: ThermalCardColumn[]): string {
  const today = todayEtYmd();
  const deskExpiries = new Set<string>();
  const parts = columns.map((c) => {
    const spot = c.heatmap?.spot;
    const call = c.heatmap?.gex?.call_wall;
    const put = c.heatmap?.gex?.put_wall;
    const flip = c.heatmap?.gex?.flip;
    const chg = c.heatmap?.change_pct;
    const shift = c.heatmap?.shift;
    const spotS = fmtSpot(spot);
    const chgS =
      Number.isFinite(chg as number)
        ? ` (${Number(chg) >= 0 ? "+" : ""}${Number(chg).toFixed(2)}%)`
        : "";
    const wallGrew = shift?.available ? shift.wall_changes : null;
    const callDrift =
      wallGrew?.call_wall?.grew_pct != null
        ? `${wallGrew.call_wall.grew_pct >= 0 ? "+" : ""}${wallGrew.call_wall.grew_pct}%`
        : "n/a";
    const putDrift =
      wallGrew?.put_wall?.grew_pct != null
        ? `${wallGrew.put_wall.grew_pct >= 0 ? "+" : ""}${wallGrew.put_wall.grew_pct}%`
        : "n/a";
    const driftNote =
      shift?.available === false
        ? " · Drift collecting"
        : ` · Wall drift C \`${callDrift}\` / P \`${putDrift}\``;
    if (c.heatmap) {
      const strikes = bandStrikesAroundSpot(
        c.heatmap.strikes,
        spot,
        THERMAL_DISCORD_STRIKE_HALF
      );
      for (const e of resolveDiscordNearExpiries(
        c.heatmap.gex?.cells,
        strikes,
        c.heatmap.near_term_expiries,
        c.heatmap.expiries,
        today,
        THERMAL_DISCORD_MAX_EXPIRIES
      )) {
        deskExpiries.add(e);
      }
    }
    return (
      `**${c.ticker}**  \`${spotS}\`${chgS}\n` +
      `Call wall \`${fmtLevel(call)}\` · Put wall \`${fmtLevel(put)}\` · Flip \`${fmtLevel(flip)}\`${driftNote}`
    );
  });
  const asOf = columns.map((c) => c.heatmap?.asof).find(Boolean);
  const sorted = [...deskExpiries].sort();
  const expiryLine =
    sorted.length > 0
      ? `Near \`${sorted.map(fmtCompactExpiry).join(" · ")}\` · as of ${fmtAsOfEt(asOf)} ET`
      : `as of ${fmtAsOfEt(asOf)} ET`;
  // Keep legend in a code span so Discord markdown cannot eat PLUS/MINUS markers.
  return (
    `**Thermal desk · GEX · NEAR** · 4K\n` +
    `${parts.join("\n")}\n` +
    "`Yellow=PLUS node · Purple=MINUS node · *=KING · DR%=build/melt`\n" +
    expiryLine
  );
}
