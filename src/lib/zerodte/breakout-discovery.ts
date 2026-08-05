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
  pickBreakoutContractWithFallback,
  pickAtmZeroDteContract,
  breakoutAllow1DteFallback,
  type BreakoutChainRow,
} from "./breakout-source";
import type { EnrichedZeroDteSetup } from "./board";
import { resolveBreakoutCandidateCap } from "./breakout-cap";
import {
  buildSessionBarFromMinuteBars,
  mergeMinuteRefreshedBars,
  type MinuteBarLike,
} from "./breakout-intraday-breadth";
import { fetchStockMinuteBars } from "@/lib/providers/polygon";

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

/** Wave C1 — refresh top pool movers from minute aggs (hybrid over grouped-daily). DEFAULT-OFF. */
export const BREAKOUT_INTRADAY_REFRESH = envFlag("BREAKOUT_INTRADAY_REFRESH");
/** Max tickers to minute-refresh per scan (Polygon budget guard). */
export const BREAKOUT_INTRADAY_REFRESH_LIMIT = 40;

/** RTH commit window in ET minutes-since-midnight: [9:30, 15:30). Aligned with
 *  NEW_PLAY_CUTOFF / G-14 — discovering after the commit gate is closed only wastes chain-fetch budget. */
const RTH_OPEN_ET_MINUTES = 9 * 60 + 30;
const RTH_CUTOFF_ET_MINUTES = 15 * 60 + 30;

/** Cap the per-ticker chain fetches per scan. The liquidity screen keeps a wider $-volume pool
 *  (`BREAKOUT_SCREEN_POOL`); this cap is applied AFTER re-ranking by momentum quality
 *  (`rankMoversForChainFetch`) so the chain-fetch budget goes to the best movers, not just
 *  mega-caps. Raised from 6→15 after the discovery-recall-probe (2026-07-20…24) showed the old
 *  $-volume top-N silently dropped 10–17 qualifying winners per session.
 *
 *  2026-08-04: this static number is now the DYNAMIC-N *floor* (safety rail for a thin day), not
 *  the whole story — `resolveBreakoutCandidateCap` (`breakout-cap.ts`) sizes the actual per-scan cap
 *  to `ceil(qualifyingMovers * 0.30)` clamped to `[BREAKOUT_MAX_CANDIDATES,
 *  BREAKOUT_MAX_CANDIDATES_CEILING]`, because raising this constant a 4th time (6→15→25→40→??) would
 *  just repeat the same leak on the next big-breadth day (see FINDINGS.md 2026-08-04 + the corrected
 *  `discovery-recall-probe.mjs` run: real qualifying pools of 100-390/day, cap stuck at 40). */
export const BREAKOUT_MAX_CANDIDATES = 40; // dynamic-N floor — raised 6→15→25→40, now a floor not a ceiling

/** Dynamic-N ceiling (2026-08-04) — bounds worst-case chain-fetch growth on a huge-breadth day to
 *  2.5x the pre-dynamic static cap. See `resolveBreakoutCandidateCap` for the sizing formula and
 *  `scripts/audit/breakout-dynamic-n-ab.mjs` for the A/B evidence that justified it. */
export const BREAKOUT_MAX_CANDIDATES_CEILING = 100;

/** Wider $-volume pool fed into the momentum re-rank before the chain-fetch cap. Liquidity filter
 *  stays in `screenBreakoutMovers` / `screenBreakdownMovers`; quality ranking is separate. Raised
 *  100→200 (2026-08-04) alongside the dynamic-N ceiling so the upstream screen itself never
 *  truncates the qualifying pool that `resolveBreakoutCandidateCap` sizes the cap from — a screen
 *  pool smaller than the ceiling would silently cap "qualifying" at the pool size, defeating the
 *  breadth-driven formula on exactly the huge-breadth days it's meant to help. */
export const BREAKOUT_SCREEN_POOL = 200;

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
  pickContract: typeof pickBreakoutContractWithFallback;
  /** Wave C1 — optional minute bar fetch for intraday breadth refresh (tests inject fakes). */
  fetchMinuteBars?: (ticker: string, from: string, to: string) => Promise<MinuteBarLike[]>;
};

const DEFAULT_DEPS: BreakoutDiscoveryDeps = {
  fetchSummary: fetchDailyMarketSummary,
  screen: screenBreakoutMovers,
  screenBreakdowns: screenBreakdownMovers,
  resolveChain: resolveTickerChainRows,
  buildSetup: buildBreakoutSetup,
  pickContract: pickBreakoutContractWithFallback,
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
  let maxCandidates = opts.maxCandidates ?? BREAKOUT_MAX_CANDIDATES;
  const nowMs = opts.nowMs ?? Date.now();
  const { fetchSummary, screen, screenBreakdowns, resolveChain, buildSetup, pickContract, fetchMinuteBars } = {
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

  // Wave C1 — hybrid intraday refresh: re-build session bars for the top momentum pool from
  // minute aggs so mid-RTH discovery isn't stuck on grouped-daily midnight `t` granularity.
  let breadthResults = results;
  const minuteFetch = fetchMinuteBars ?? fetchStockMinuteBars;
  if (BREAKOUT_INTRADAY_REFRESH) {
    // Use the CEILING (not the current maxCandidates) to size the pre-pool: at this point
    // maxCandidates is still the pre-dynamic floor/opts value, and the intraday-refresh pool needs
    // to be wide enough to cover whatever the dynamic-cap formula resolves to below.
    const prePool = Math.max(BREAKOUT_MAX_CANDIDATES_CEILING * 4, BREAKOUT_SCREEN_POOL);
    const preLong = screen(results, prePool);
    const preShort = screenBreakdowns(results, prePool);
    const tickers = [
      ...new Set([...preLong, ...preShort].map((m) => m.ticker.toUpperCase())),
    ].slice(0, BREAKOUT_INTRADAY_REFRESH_LIMIT);
    const refreshed = new Map<string, DailyMarketBar>();
    await Promise.all(
      tickers.map(async (t) => {
        const bars = await minuteFetch(t, today, today).catch(() => []);
        const minuteBars: MinuteBarLike[] = [];
        for (const b of bars) {
          if (typeof b.t !== "number" || !Number.isFinite(b.t) || !Number.isFinite(b.o) || !Number.isFinite(b.c)) continue;
          minuteBars.push({
            t: b.t,
            o: b.o,
            h: b.h ?? b.o,
            l: b.l ?? b.o,
            c: b.c,
            v: b.v ?? 0,
          });
        }
        const bar = buildSessionBarFromMinuteBars(t, minuteBars);
        if (bar) refreshed.set(t, bar);
      })
    );
    if (refreshed.size > 0) {
      breadthResults = mergeMinuteRefreshedBars(results, refreshed);
      console.info(`[zerodte-breakout] intraday minute refresh: ${refreshed.size}/${tickers.length} tickers`);
    }
  }

  // Screen BOTH directions from the breadth snapshot: breakouts (LONG) and breakdowns
  // (SHORT). Pull a wider $-volume pool, then re-rank by momentum quality before the chain-fetch
  // cap so mid-cap continuations are not starved by mega-cap $-volume. A ticker that qualifies on
  // BOTH sides (rare) keeps the breakout (long) — the higher-conviction direction for a momentum board.
  // Size the upstream screen pool by the CEILING, not the pre-dynamic maxCandidates, so the
  // qualifying-pool count fed into resolveBreakoutCandidateCap below isn't itself truncated by a
  // pool sized for the (smaller) floor — that would silently cap "qualifying" at the pool size and
  // defeat the breadth-driven formula on exactly the huge-breadth days it exists for.
  const screenPool = Math.max(BREAKOUT_MAX_CANDIDATES_CEILING * 4, BREAKOUT_SCREEN_POOL);
  const longMovers = screen(breadthResults, screenPool).filter((m) => !excludeTickers.has(m.ticker.toUpperCase()));
  const shortMovers = screenBreakdowns(breadthResults, screenPool).filter(
    (m) => !excludeTickers.has(m.ticker.toUpperCase())
  );

  // Dynamic-N (2026-08-04): size the chain-fetch cap to today's qualifying breadth instead of a
  // fixed number. Tests that pass an explicit `opts.maxCandidates` keep their exact override (a
  // deliberate hard cap for hermetic assertions); production never passes it, so the live board
  // always goes through the dynamic formula. See breakout-cap.ts for the sizing rationale.
  if (opts.maxCandidates === undefined) {
    maxCandidates = resolveBreakoutCandidateCap({
      qualifyingMovers: longMovers.length + shortMovers.length,
      floor: BREAKOUT_MAX_CANDIDATES,
      ceiling: BREAKOUT_MAX_CANDIDATES_CEILING,
    });
  }

  if (longMovers.length === 0 && shortMovers.length === 0) {
    console.info("[zerodte-breakout] breadth snapshot present but zero qualifying breakouts/breakdowns -- SKIP");
    return { status: "ok", setups: [] };
  }

  // Build a helper to resolve one mover into a setup, parameterized by direction.
  // Returns a tagged miss so the walk-until-built loop can log WHY the chain budget
  // produced zero setups (the 2026-07-29 FLOW-only regression: every momentum-top
  // name had only weeklies → no_same_day_contract, and the $400 price cap had already
  // dropped MU/AMD/META — the names that DO list 0DTE).
  type BuildMiss = "no_chain" | "no_0dte_contract" | "no_same_day_contract" | "error";
  const buildOne = async (
    mover: (typeof longMovers)[number],
    direction: "long" | "short",
    maxDollar: number
  ): Promise<{ setup: EnrichedZeroDteSetup | null; miss: BuildMiss | null; oneDteFallback?: boolean }> => {
    try {
      const chain = await resolveChain(mover.ticker).catch(() => null);
      if (!chain || !(chain.spot > 0) || chain.rows.length === 0) {
        return { setup: null, miss: "no_chain" };
      }
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
      const side = direction === "long" ? ("call" as const) : ("put" as const);
      const picked = pickContract(rows, chain.spot, today, side);
      if (!picked) {
        const has0 = pickAtmZeroDteContract(rows, chain.spot, today, 0, side);
        const has1 =
          breakoutAllow1DteFallback() ? pickAtmZeroDteContract(rows, chain.spot, today, 1, side) : null;
        if (!has0 && has1 && !breakoutAllow1DteFallback()) {
          return { setup: null, miss: "no_0dte_contract" as const };
        }
        return { setup: null, miss: "no_same_day_contract" as const };
      }
      const { used_1dte_fallback, ...contract } = picked;
      const dollarNorm = maxDollar > 0 ? mover.dollar / maxDollar : 0;
      return {
        setup: buildSetup({ mover, spot: chain.spot, contract, dollarNorm, direction, todayYmd: today }),
        miss: null,
        oneDteFallback: used_1dte_fallback,
      };
    } catch {
      return { setup: null, miss: "error" }; // best-effort per ticker — one bad chain never sinks the batch
    }
  };

  // Normalize $-volume within each cohort independently.
  const longMaxDollar = longMovers.reduce((m, x) => Math.max(m, x.dollar), 0);
  const shortMaxDollar = shortMovers.reduce((m, x) => Math.max(m, x.dollar), 0);

  // Walk a WIDER momentum-ranked pool until we FILL `maxCandidates` setups (or exhaust
  // the fetch budget). Taking a hard top-N then Promise.all-ing used to spend the entire
  // budget on non-optionable names and return `built 0` even when later-ranked movers
  // (MU/AMD-class after the price-cap fix) would have picked a same-day contract.
  // Try up to 4× the seat budget (capped by the screen pool) so a streak of
  // weekly-only names at the top of the momentum rank cannot zero the rail.
  const fetchBudget = Math.min(Math.max(maxCandidates * 4, 60), BREAKOUT_SCREEN_POOL);
  const rankedLong = rankMoversForChainFetch(longMovers, fetchBudget, "long");
  const rankedShort = rankMoversForChainFetch(shortMovers, fetchBudget, "short");
  // Dedup: if a ticker appears on BOTH sides, keep the long (breakout) only.
  const longTickers = new Set(rankedLong.map((m) => m.ticker.toUpperCase()));
  const dedupedShort = rankedShort.filter((m) => !longTickers.has(m.ticker.toUpperCase()));

  const BATCH = 8;
  const stats = { attempted: 0, no_chain: 0, no_0dte_contract: 0, no_same_day_contract: 0, one_dte_fallback: 0, error: 0 };

  async function fillSide(
    ranked: typeof rankedLong,
    direction: "long" | "short",
    maxDollar: number,
    limit: number
  ): Promise<EnrichedZeroDteSetup[]> {
    const out: EnrichedZeroDteSetup[] = [];
    for (let i = 0; i < ranked.length && out.length < limit; i += BATCH) {
      const batch = ranked.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((m) => buildOne(m, direction, maxDollar)));
      for (const r of results) {
        stats.attempted += 1;
        if (r.setup) {
          out.push(r.setup);
          if (r.oneDteFallback) stats.one_dte_fallback += 1;
          if (out.length >= limit) break;
        } else if (r.miss) {
          stats[r.miss] += 1;
        }
      }
    }
    return out;
  }

  // Each side may fill up to maxCandidates (same capacity as the pre-walk top-N
  // Promise.all). The walk only changes WHICH names get a chain fetch — it still
  // stops a side once that side has enough same-day setups.
  const [longSetups, shortSetups] = await Promise.all([
    fillSide(rankedLong, "long", longMaxDollar, maxCandidates),
    fillSide(dedupedShort, "short", shortMaxDollar, maxCandidates),
  ]);
  const setups = [...longSetups, ...shortSetups];
  console.info(
    `[zerodte-breakout] ${longMovers.length} breakouts + ${shortMovers.length} breakdowns (pool), ` +
      `built ${setups.length} setup(s) (${longSetups.length}L/${shortSetups.length}S) ` +
      `from walk ${rankedLong.length}L+${dedupedShort.length}S ` +
      `attempted=${stats.attempted} no_chain=${stats.no_chain} ` +
      `no_0dte=${stats.no_0dte_contract} no_same_day=${stats.no_same_day_contract} ` +
      `1dte_fallback=${stats.one_dte_fallback} err=${stats.error}`
  );
  return { status: "ok", setups };
}
