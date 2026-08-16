/** Minute bar shape for intraday reaction math (Polygon aggs). */
export type MinuteBarLike = { t?: number; o: number; h: number; l: number; c: number };

export type IntradayReaction = {
  release_price: number | null;
  move_pct_30: number | null;
  move_pct_60: number | null;
};

function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return Number((((to - from) / Math.abs(from)) * 100).toFixed(2));
}

/** ET minutes since midnight from a UTC ms timestamp. */
export function etMinutesFromMs(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(ms));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hh * 60 + mm;
}

function releaseMinutes(releaseTimeEt: string): number | null {
  const [hh, mm] = releaseTimeEt.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

/** Close price at or just after release minute; fallback to nearest bar within 5 min. */
function priceAtRelease(bars: MinuteBarLike[], releaseMin: number): number | null {
  let best: { dist: number; price: number } | null = null;
  for (const bar of bars) {
    if (bar.t == null || !Number.isFinite(bar.c)) continue;
    const mins = etMinutesFromMs(bar.t);
    const dist = mins - releaseMin;
    if (dist < -2 || dist > 5) continue;
    const price = bar.c;
    const absDist = Math.abs(dist);
    if (!best || absDist < best.dist) best = { dist: absDist, price };
  }
  return best?.price ?? null;
}

/** Price at release + N minutes (uses bar close at or after target minute). */
function priceAfterMinutes(
  bars: MinuteBarLike[],
  releaseMin: number,
  offsetMin: number
): number | null {
  const target = releaseMin + offsetMin;
  let best: { dist: number; price: number } | null = null;
  for (const bar of bars) {
    if (bar.t == null || !Number.isFinite(bar.c)) continue;
    const mins = etMinutesFromMs(bar.t);
    if (mins < target - 1) continue;
    const dist = mins - target;
    if (dist > 10) break;
    if (!best || dist < best.dist) best = { dist, price: bar.c };
  }
  return best?.price ?? null;
}

/**
 * SPX/stock move in the 30–60 min window after a scheduled release (ET).
 * Uses Polygon minute bars for the session date.
 */
export function intradayReactionFromBars(
  bars: MinuteBarLike[],
  releaseTimeEt: string
): IntradayReaction {
  const releaseMin = releaseMinutes(releaseTimeEt);
  if (releaseMin == null || !bars.length) {
    return { release_price: null, move_pct_30: null, move_pct_60: null };
  }
  const releasePrice = priceAtRelease(bars, releaseMin);
  if (releasePrice == null) {
    return { release_price: null, move_pct_30: null, move_pct_60: null };
  }
  const p30 = priceAfterMinutes(bars, releaseMin, 30);
  const p60 = priceAfterMinutes(bars, releaseMin, 60);
  return {
    release_price: releasePrice,
    move_pct_30: p30 != null ? pctChange(releasePrice, p30) : null,
    move_pct_60: p60 != null ? pctChange(releasePrice, p60) : null,
  };
}
