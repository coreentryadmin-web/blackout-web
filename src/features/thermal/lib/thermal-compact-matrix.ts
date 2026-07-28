/**
 * Compare-desk matrix helpers — near-term expiries + strike band around spot
 * so SPY | SPX | QQQ share one surface. Cell chrome/fonts live in globals.css
 * and match the major Thermal matrix (not the Discord card’s denser raster).
 */

/** Compact expiry label: YYYY-MM-DD → M/D */
export function fmtCompactExpiry(exp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(exp ?? "").trim());
  if (!m) return String(exp ?? "").slice(0, 5);
  return `${Number(m[2])}/${Number(m[3])}`;
}

/**
 * Prefer the server's near-term allow-list (walls/flip scope), else the full
 * expiry axis — then cap so three desks fit.
 */
export function resolveCompactExpiries(
  nearTerm: string[] | undefined | null,
  all: string[] | undefined | null,
  max = 8,
): string[] {
  const src =
    Array.isArray(nearTerm) && nearTerm.length > 0
      ? nearTerm
      : Array.isArray(all)
        ? all
        : [];
  return src.slice(0, Math.max(1, max));
}

/**
 * Single 0DTE expiry for the compare heat-strip: today's date if present on the
 * axis, else the earliest near-term / axis expiry (same rule as Thermal 0DTE chip).
 */
export function resolveZeroDteExpiry(
  nearTerm: string[] | undefined | null,
  all: string[] | undefined | null,
  todayYmd?: string | null,
): string | null {
  const axis = resolveCompactExpiries(nearTerm, all, 64);
  if (axis.length === 0) return null;
  const today =
    typeof todayYmd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(todayYmd)
      ? todayYmd
      : null;
  if (today && axis.includes(today)) return today;
  return axis[0] ?? null;
}

/**
 * Band strikes around spot. Prefer equal rows above/below when possible.
 * Falls back to full list when spot is missing.
 */
export function bandStrikesAroundSpot(
  strikes: number[] | undefined | null,
  spot: number | null | undefined,
  halfWidth = 14,
): number[] {
  if (!Array.isArray(strikes) || strikes.length === 0) return [];
  if (!Number.isFinite(spot as number)) return strikes;
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

export function nearestStrikeIndex(strikes: number[], spot: number | null | undefined): number {
  if (!strikes.length || !Number.isFinite(spot as number)) return -1;
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
  return nearest;
}

/** Dense money labels for ultra-narrow expiry columns (+2.5M / −150K / ·). */
export function fmtCompactHeatMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "·";
  const sign = n > 0 ? "+" : "−";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}K`;
  return `${sign}${Math.round(abs)}`;
}

/** Peak |value| across a compact window — drives heatmapCellStyle intensity. */
export function compactMatrixPeak(
  cells: Record<string, Record<string, number>> | undefined,
  strikes: number[],
  expiries: string[],
): number {
  let peak = 0;
  if (!cells) return 0;
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

export type CompactDayExtremes = {
  /** Highest + cell in the expiry column → yellow call / + node. */
  callWall: number | null;
  /** Lowest − cell in the expiry column → purple put / − node. */
  putWall: number | null;
  /** argmax |cell| in the expiry column → king node. */
  king: number | null;
};

/**
 * Per-expiry walls + king — same ascending-strike / strict tie-break as the
 * major Thermal matrix (lowest strike wins). Pure; safe for render.
 */
export function compactPerExpiryExtremes(
  cells: Record<string, Record<string, number>> | undefined,
  strikes: number[],
  expiries: string[],
): Record<string, CompactDayExtremes> {
  const out: Record<string, CompactDayExtremes> = {};
  if (!cells) {
    for (const e of expiries) out[e] = { callWall: null, putWall: null, king: null };
    return out;
  }
  const strikesAsc = [...strikes].sort((a, b) => a - b);
  for (const e of expiries) {
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
