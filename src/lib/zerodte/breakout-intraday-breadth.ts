// Wave C1 — build live session OHLCV from minute bars for BREAKOUT breadth refresh.
// Pure helpers only; IO lives in breakout-discovery.ts (hybrid grouped-daily + minute top-N).

import type { DailyMarketBar } from "@/lib/providers/polygon";

export type MinuteBarLike = { t: number; o: number; h: number; l: number; c: number; v: number };

/** Aggregate RTH minute bars into one session bar matching grouped-daily shape. */
export function buildSessionBarFromMinuteBars(
  ticker: string,
  bars: readonly MinuteBarLike[],
  sessionOpenMs?: number
): DailyMarketBar | null {
  if (bars.length === 0) return null;
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  const o = sorted[0]!.o;
  let h = sorted[0]!.h;
  let l = sorted[0]!.l;
  let c = sorted[sorted.length - 1]!.c;
  let v = 0;
  let latestT = sorted[sorted.length - 1]!.t;
  for (const b of sorted) {
    if (Number.isFinite(b.h)) h = Math.max(h, b.h);
    if (Number.isFinite(b.l)) l = Math.min(l, b.l);
    if (Number.isFinite(b.c)) c = b.c;
    if (Number.isFinite(b.v)) v += b.v;
    if (Number.isFinite(b.t) && b.t > latestT) latestT = b.t;
  }
  if (!Number.isFinite(o) || !Number.isFinite(c) || c <= 0) return null;
  return {
    T: ticker.toUpperCase(),
    o,
    h,
    l,
    c,
    v,
    t: sessionOpenMs ?? sorted[0]!.t,
    vw: c,
    n: sorted.length,
    // grouped-daily optional fields — not required for screenBreakoutMovers
  } as DailyMarketBar;
}

/** Replace grouped-daily rows for tickers we refreshed with minute-derived session bars. */
export function mergeMinuteRefreshedBars(
  base: readonly DailyMarketBar[],
  refreshed: ReadonlyMap<string, DailyMarketBar>
): DailyMarketBar[] {
  if (refreshed.size === 0) return [...base];
  const out: DailyMarketBar[] = [];
  const seen = new Set<string>();
  for (const bar of base) {
    const t = bar.T?.toUpperCase();
    if (!t) continue;
    seen.add(t);
    out.push(refreshed.get(t) ?? bar);
  }
  for (const [t, bar] of refreshed) {
    if (!seen.has(t)) out.push(bar);
  }
  return out;
}
