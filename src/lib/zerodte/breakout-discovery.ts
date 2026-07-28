// ── BREAKOUT discovery — IO orchestration (Phase 3a) ──────────────────────────────
// The provider-touching half of the BREAKOUT source (the pure half is breakout-source.ts).
// Dynamic-imported from scan.ts ONLY when the source is flag-enabled, so the flow-only board
// never loads the whole-market provider graph (grouped-daily breadth + per-ticker option chain).
//
// INTRADAY BREADTH SOURCING (the design's mandatory adaptation, §1a): the edition's banger lane
// feeds screenBreakoutMovers a grouped-daily bar of a FINISHED session. Intraday that would be a
// stale prior-day bar. Here we read TODAY's grouped-daily summary — during RTH Polygon returns
// the LIVE, still-incomplete current-session bar (real session open + accumulating h/l/c/v), which
// is exactly the live intraday snapshot we want. Off-hours / pre-open that call returns EMPTY, and
// we SKIP (return [], logged) rather than feed the screen a stale bar. We also gate to the RTH
// commit window so a completed after-close "today" bar is never treated as live.
//
// WS-19 FAIL-CLOSED STALENESS GUARD: a *successful, non-empty* grouped response used to be trusted
// unconditionally — but a provider/cache hiccup can serve a stale-but-non-empty snapshot (e.g.
// yesterday's bars) during RTH. That would silently drive discovery off dead data and, worse, a
// stale snapshot that screens to nothing would read as "no breakouts today" (a genuine empty) when
// the truth is "we don't know". We now read the freshest bar's provider timestamp and, if its age
// exceeds BREAKOUT_MAX_BAR_AGE_MS (or no bar exposes a timestamp at all), return `data_unavailable`
// — failing CLOSED — instead of an empty candidate list. This can only ever REMOVE stale-driven
// candidates, never add any.

import { fetchDailyMarketSummary, type DailyMarketBar } from "@/lib/providers/polygon";
import { screenBreakoutMovers, screenBreakdownMovers } from "@/features/nighthawk/lib/candidates";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import {
  buildBreakoutSetup,
  pickAtmZeroDteContract,
  type BreakoutChainRow,
} from "./breakout-source";
import type { EnrichedZeroDteSetup } from "./board";

/** RTH commit window in ET minutes-since-midnight: [9:30, 14:00). Aligned with
 *  NEW_PLAY_CUTOFF / G-14 (FINDINGS 2026-07-28) — discovering after the commit gate is closed
 *  only wastes chain-fetch budget. Was left at 15:00 when the cutoff moved to 14:00. */
const RTH_OPEN_ET_MINUTES = 9 * 60 + 30;
const RTH_CUTOFF_ET_MINUTES = 14 * 60;

/** Cap the per-ticker chain fetches per scan. The liquidity screen keeps a wider $-volume pool
 *  (`BREAKOUT_SCREEN_POOL`); this cap is applied AFTER re-ranking by momentum quality
 *  (`rankMoversForChainFetch`) so the chain-fetch budget goes to the best movers, not just
 *  mega-caps. Raised from 6→15 after the discovery-recall-probe (2026-07-20…24) showed the old
 *  $-volume top-N silently dropped 10–17 qualifying winners per session. */
export const BREAKOUT_MAX_CANDIDATES = 25; // raised 6→15→25 — recall probe showed top-N by $vol was leaky

/** Wider $-volume pool fed into the momentum re-rank before the chain-fetch cap. Liquidity filter
 *  stays in `screenBreakoutMovers` / `screenBreakdownMovers`; quality ranking is separate. */
export const BREAKOUT_SCREEN_POOL = 100;

/**
 * Rank screened movers for the chain-fetch budget. Liquidity already gated the pool; this orders
 * by momentum quality so a sharp mid-cap continuation outranks a sluggish mega-cap grind.
 * - long / breakout: `gain × close_strength` (strong close = conviction)
 * - short / breakdown: `gain × (1 − close_strength)` (weak close = conviction)
 * Ties break by $-volume (still prefer tradeable names). Pure.
 */
export function rankMoversForChainFetch<T extends { gain: number; close_strength: number; dollar: number }>(
  movers: readonly T[],
  maxKeep: number,
  side: "long" | "short"
): T[] {
  const quality = (m: T): number =>
    side === "long" ? m.gain * m.close_strength : m.gain * (1 - m.close_strength);
  return [...movers]
    .sort((a, b) => {
      const dq = quality(b) - quality(a);
      if (dq !== 0) return dq;
      return b.dollar - a.dollar;
    })
    .slice(0, maxKeep);
}

/**
 * WS-19 — fail-closed max age for the whole-market grouped-daily snapshot.
 *
 * DAILY-GRANULARITY LIMITATION (commented deliberately, per the WS-19 brief): Polygon grouped-daily
 * bars are DAILY aggregates. Each bar's `t` is the Unix-ms START of that trading day's aggregate
 * window (session-open, ≈ midnight ET of the bar's date) — NOT a live tick time. So this signal
 * cannot observe *intra-session* staleness (a bar that stopped updating at, say, 11:00 ET still
 * reports today's `t`). What it CAN prove — and the dominant real failure this guard closes — is a
 * PRIOR-DAY (carried-over / cached) snapshot served during RTH: its freshest bar is dated to an
 * earlier session, so `now − t` jumps past a full day.
 *
 * THRESHOLD RATIONALE: discoverBreakoutSetups only runs inside the RTH commit window [9:30, 14:00)
 * ET, so a genuine same-day live bar's `now − t` is at most ~14h (t ≈ midnight ET) — and up to ~20h
 * once the widest `t`-convention / DST skew is allowed for. A prior-day snapshot is ≥ ~33h old. 24h
 * sits cleanly between the two: strictly above any legitimate same-day age, strictly below any
 * prior-day bar. We fail CLOSED past it rather than fabricate confidence in an unverifiable bar.
 */
export const BREAKOUT_MAX_BAR_AGE_MS = 24 * 60 * 60 * 1000;

/** Outcome of a freshness assessment over a grouped-daily result set (WS-19). */
export type GroupedBarFreshness =
  | { fresh: true; freshestBarMs: number; ageMs: number }
  | { fresh: false; reason: "missing_bar_timestamp" }
  | { fresh: false; reason: "stale_snapshot"; freshestBarMs: number; ageMs: number };

/**
 * Assess whether a NON-EMPTY grouped-daily result set is fresh enough to drive discovery.
 * Reads the freshest bar's provider `t` (Unix-ms window start) and compares its age to
 * BREAKOUT_MAX_BAR_AGE_MS. Fails CLOSED when no bar exposes a usable timestamp (we cannot prove
 * freshness → do not trust it; do NOT fabricate a timestamp) or when the freshest bar is too old.
 * A future/clock-skewed `t` (negative age) is treated as fresh — fail-closed only ever REMOVES.
 */
export function assessGroupedBarFreshness(
  results: ReadonlyArray<Pick<DailyMarketBar, "t">>,
  nowMs: number
): GroupedBarFreshness {
  let freshestBarMs = Number.NEGATIVE_INFINITY;
  for (const bar of results) {
    const t = bar.t;
    if (typeof t === "number" && Number.isFinite(t) && t > freshestBarMs) freshestBarMs = t;
  }
  if (freshestBarMs === Number.NEGATIVE_INFINITY) {
    return { fresh: false, reason: "missing_bar_timestamp" };
  }
  const ageMs = nowMs - freshestBarMs;
  if (ageMs > BREAKOUT_MAX_BAR_AGE_MS) {
    return { fresh: false, reason: "stale_snapshot", freshestBarMs, ageMs };
  }
  return { fresh: true, freshestBarMs, ageMs };
}

/** Discriminated result of a breakout discovery pass. `setups` is ALWAYS present (possibly empty).
 *  `status` lets callers distinguish "fresh data, genuinely no breakouts" (`ok`, empty setups) from
 *  "we could not trust the snapshot" (`data_unavailable`) — the WS-19 fail-closed distinction. */
export type BreakoutDiscoveryOutcome = {
  status:
    | "ok" // fresh snapshot screened normally (setups may be empty = genuinely no breakouts today)
    | "skip_off_hours" // outside the RTH commit window
    | "skip_empty_market" // grouped-daily returned zero bars / a provider miss (no live snapshot)
    | "data_unavailable"; // WS-19: snapshot present but STALE or unverifiable → fail closed
  setups: EnrichedZeroDteSetup[];
  /** Present only when status === "data_unavailable" — why we failed closed. */
  reason?: "stale_snapshot" | "missing_bar_timestamp";
};

/** Injectable IO seam -- real providers by default; tests substitute hermetic fakes. */
export type BreakoutDiscoveryDeps = {
  fetchSummary: typeof fetchDailyMarketSummary;
  screen: typeof screenBreakoutMovers;
  screenBreakdowns: typeof screenBreakdownMovers;
  resolveChain: typeof resolveTickerChainRows;
  buildSetup: typeof buildBreakoutSetup;
  pickContract: typeof pickAtmZeroDteContract;
};

const DEFAULT_DEPS: BreakoutDiscoveryDeps = {
  fetchSummary: fetchDailyMarketSummary,
  screen: screenBreakoutMovers,
  screenBreakdowns: screenBreakdownMovers,
  resolveChain: resolveTickerChainRows,
  buildSetup: buildBreakoutSetup,
  pickContract: pickAtmZeroDteContract,
};

/**
 * Discover BREAKOUT-origin setups for the live board. Returns a discriminated {@link
 * BreakoutDiscoveryOutcome}: `ok` (fresh data — `setups` may be empty when nothing qualified),
 * a `skip_*` (off-hours / no live snapshot), or `data_unavailable` (WS-19 fail-closed: a stale or
 * unverifiable snapshot). The source NEVER fabricates candidates from stale data, and a stale
 * snapshot is NEVER reported as a genuine empty. Best-effort throughout: any thrown failure degrades
 * to a `skip_empty_market` outcome and the flow board is untouched.
 */
export async function discoverBreakoutSetups(opts: {
  today: string;
  nowEtMinutes: number;
  /** Tickers to exclude (static excludes + Night Hawk-covered names), same set the flow path uses. */
  excludeTickers: Set<string>;
  maxCandidates?: number;
  /** Absolute wall-clock (Unix ms) for the WS-19 freshness check. Defaults to Date.now(); injected in tests. */
  nowMs?: number;
  /** IO seam override for tests; production omits it and uses the real providers. */
  deps?: Partial<BreakoutDiscoveryDeps>;
}): Promise<BreakoutDiscoveryOutcome> {
  const { today, nowEtMinutes, excludeTickers } = opts;
  const maxCandidates = opts.maxCandidates ?? BREAKOUT_MAX_CANDIDATES;
  const nowMs = opts.nowMs ?? Date.now();
  const { fetchSummary, screen, screenBreakdowns, resolveChain, buildSetup, pickContract } = {
    ...DEFAULT_DEPS,
    ...opts.deps,
  };

  if (nowEtMinutes < RTH_OPEN_ET_MINUTES || nowEtMinutes >= RTH_CUTOFF_ET_MINUTES) {
    console.info("[zerodte-breakout] outside the RTH commit window -- SKIP (no live intraday breadth)");
    return { status: "skip_off_hours", setups: [] };
  }

  // TODAY's grouped-daily = the LIVE incomplete session bar during RTH (never a prior-day bar).
  const summary = await fetchSummary(today).catch(() => null);
  const results = summary?.results ?? [];
  if (results.length === 0) {
    console.info("[zerodte-breakout] no live intraday breadth snapshot (empty grouped-daily) -- SKIP");
    return { status: "skip_empty_market", setups: [] };
  }

  // WS-19: a non-empty snapshot must also be FRESH. A stale (or timestamp-less) snapshot fails
  // CLOSED as data_unavailable -- never an empty candidate list -- so it can never be mistaken for a
  // genuine "no breakouts today". This gate can only remove stale-driven candidates, never add any.
  const freshness = assessGroupedBarFreshness(results, nowMs);
  if (!freshness.fresh) {
    const ageStr =
      freshness.reason === "stale_snapshot" ? ` (age ${Math.round(freshness.ageMs / 3_600_000)}h)` : "";
    console.warn(
      `[zerodte-breakout] grouped-daily snapshot ${freshness.reason}${ageStr} -- DATA_UNAVAILABLE (fail closed, not "no breakouts")`
    );
    return { status: "data_unavailable", setups: [], reason: freshness.reason };
  }

  // Screen BOTH directions from the same grouped-daily snapshot: breakouts (LONG) and breakdowns
  // (SHORT). Pull a wider $-volume pool, then re-rank by momentum quality before the chain-fetch
  // cap so mid-cap continuations are not starved by mega-cap $-volume. A ticker that qualifies on
  // BOTH sides (rare) keeps the breakout (long) — the higher-conviction direction for a momentum board.
  const screenPool = Math.max(maxCandidates * 4, BREAKOUT_SCREEN_POOL);
  const longMovers = screen(results, screenPool).filter((m) => !excludeTickers.has(m.ticker.toUpperCase()));
  const shortMovers = screenBreakdowns(results, screenPool).filter(
    (m) => !excludeTickers.has(m.ticker.toUpperCase())
  );

  if (longMovers.length === 0 && shortMovers.length === 0) {
    console.info("[zerodte-breakout] breadth snapshot present but zero qualifying breakouts/breakdowns -- SKIP");
    return { status: "ok", setups: [] };
  }

  // Build a helper to resolve one mover into a setup, parameterized by direction.
  const buildOne = async (
    mover: (typeof longMovers)[number],
    direction: "long" | "short",
    maxDollar: number
  ): Promise<EnrichedZeroDteSetup | null> => {
    try {
      const chain = await resolveChain(mover.ticker).catch(() => null);
      if (!chain || !(chain.spot > 0) || chain.rows.length === 0) return null;
      const rows: BreakoutChainRow[] = chain.rows.map((r) => ({
        expiry: r.expiry,
        strike: r.strike,
        call_bid: r.call_bid,
        call_ask: r.call_ask,
        call_oi: r.call_oi,
        put_bid: r.put_bid,
        put_ask: r.put_ask,
        put_oi: r.put_oi,
      }));
      // Breakouts pick a CALL; breakdowns pick a PUT.
      const side = direction === "long" ? "call" as const : "put" as const;
      const contract = pickContract(rows, chain.spot, today, 1, side);
      if (!contract) return null;
      const dollarNorm = maxDollar > 0 ? mover.dollar / maxDollar : 0;
      return buildSetup({ mover, spot: chain.spot, contract, dollarNorm, direction });
    } catch {
      return null; // best-effort per ticker -- one bad chain never sinks the batch
    }
  };

  // Normalize $-volume within each cohort independently, then momentum-rank + cap each side.
  const longMaxDollar = longMovers.reduce((m, x) => Math.max(m, x.dollar), 0);
  const shortMaxDollar = shortMovers.reduce((m, x) => Math.max(m, x.dollar), 0);
  const topLong = rankMoversForChainFetch(longMovers, maxCandidates, "long");
  const topShort = rankMoversForChainFetch(shortMovers, maxCandidates, "short");

  // Dedup: if a ticker appears on BOTH sides, keep the long (breakout) only.
  const longTickers = new Set(topLong.map((m) => m.ticker.toUpperCase()));
  const dedupedShort = topShort.filter((m) => !longTickers.has(m.ticker.toUpperCase()));

  const built = await Promise.all([
    ...topLong.map((m) => buildOne(m, "long", longMaxDollar)),
    ...dedupedShort.map((m) => buildOne(m, "short", shortMaxDollar)),
  ]);

  const setups = built.filter((s): s is EnrichedZeroDteSetup => s != null);
  console.info(
    `[zerodte-breakout] ${longMovers.length} breakouts + ${shortMovers.length} breakdowns (pool), ` +
    `built ${setups.length} setup(s) from momentum-top ${topLong.length}L + ${dedupedShort.length}S`
  );
  return { status: "ok", setups };
}
