// ── PIN discovery — IO orchestration (Phase 3b) ────────────────────────────────────────────
// The provider-touching half of the PIN source (the pure half is pin-source.ts). Dynamic-imported
// from scan.ts ONLY when the source is flag-enabled, so the flow-only board never loads the
// whole-universe GEX/provider graph.
//
// UNIVERSE (the design's "liquid set", §1a): a pin needs BOTH a per-ticker dealer-gamma ladder AND
// a liquid same-day/weekly option chain, so this is NOT the whole ~12k market (unlike BREAKOUT,
// which screens a grouped-daily bar). It is a curated LIQUID set: the 0DTE-listed index products
// (SPX + SPY/QQQ/IWM/DIA) plus the most-liquid mega-cap single names with real weekly chains. The
// index products are the core — they carry true daily 0DTE and the deepest, most dealer-defended
// gamma walls, which is exactly where a pin forms. Override via ZERODTE_PIN_UNIVERSE (comma list).
//
// PER TICKER: reuse the EXISTING gamma math — fetchGexHeatmap → gexPositioningFromHeatmap for the
// canonical spot/flip/posture/call_wall/put_wall, and computeGexWalls(strike_totals) for each wall's
// share of ladder |gamma| (dominance). Both derive the SAME top-wall strikes by construction
// (gex-wall-levels.ts doc), so the strike and its dominance are consistent. evaluatePinRegime then
// decides whether spot is genuinely pinned between dominant walls in a long-gamma tape, and if so
// which way the fade points; a clean pin → pick an ATM fade contract off the live chain → build the
// seed setup. NO clean pin, a provider miss, or off-hours → SKIP (return [], logged) — never fabricate.
//
// FETCH-FAILURE-VS-GENUINE-EMPTY DISCLOSURE (found 2026-11-09, live production audit, the PIN/
// MOMENTUM half of the gap breakout-discovery.ts's `skip_fetch_failed` fixed for BREAKOUT the same
// day — #7786). Both per-ticker IO calls below (`fetchGexHeatmap`, `resolveTickerChainRows`) used to
// be wrapped in a bare `.catch(() => null)`, which collapsed a THROWN upstream error (confirmed live:
// `GET /api/market/gex-heatmap?ticker=SPY|SPX|AAPL` all returned `available:false` during active RTH
// — the already-documented Polygon/Massive real-time-snapshot entitlement outage in CLAUDE.md) onto
// the IDENTICAL per-ticker "this name has no clean pin" outcome a genuinely quiet, fully-fetched
// ticker produces. Scanned across the whole curated universe, a universe-wide outage (every ticker's
// fetch throwing) was indistinguishable from "nothing in the market is pinned today" — both drove
// `setups.length === 0`, and scan.ts reported `discovery_health.PIN: {status:"ok", setups:0}` either
// way, the exact absence-vs-failure conflation the Largo product contract forbids. We now track
// whether EACH per-ticker fetch actually threw (never whether it merely found nothing), and when
// FETCH_FAILURE_RATE_THRESHOLD (90%) or more of the evaluated universe's fetches threw, report a
// `skip_fetch_failed` outcome instead of a genuine `ok` zero — a lone flaky name among ~20 evaluated
// never trips this, only a real, near-universal outage does.

import {
  PIN_CONDOR_LATE_CUTOFF_ET_MINUTES,
  PIN_RTH_CUTOFF_ET_MINUTES,
  PIN_RTH_OPEN_ET_MINUTES,
} from "./pin-window";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { gexPositioningFromHeatmap } from "@/lib/providers/gex-positioning";
import { computeGexWalls, mapFromStrikeTotalsRecord } from "@/lib/providers/gex-wall-levels";
import { resolveTickerChainRows } from "@/features/nighthawk/lib/option-chain-prompt";
import { buildPinSetup, evaluatePinRegime, pickAtmPinContract, pinScore, type PinChainRow } from "./pin-source";
import { stampPinSetupPositioning } from "./thesis/pin-positioning-stamp";
import {
  buildCondorPlan,
  buildCondorSetup,
  condorEligibleTicker,
  condorFlagEnabled,
  condorSellRegime,
  type CondorLegQuote,
} from "./condor";
import { selectIronCondor } from "./iron-condor";
import type { EnrichedZeroDteSetup } from "./board";
import { pinPassesTemporalStabilityGate } from "./pin-temporal-stability";

// Window constants live in ./pin-window (pure, no `server-only`) so the scan orchestrator and unit
// tests can read the SAME numbers without importing this provider-heavy module. Re-aliased to the
// local names the body already uses. After 15:30, discovery continues ONLY for condor-eligible
// index roots until CONDOR_LATE_CUTOFF (no new seats after the directional cutoff).
const RTH_OPEN_ET_MINUTES = PIN_RTH_OPEN_ET_MINUTES;
const RTH_CUTOFF_ET_MINUTES = PIN_RTH_CUTOFF_ET_MINUTES;
const CONDOR_LATE_CUTOFF_ET_MINUTES = PIN_CONDOR_LATE_CUTOFF_ET_MINUTES;

/** The curated LIQUID pin universe (see the file header). Index products first -- the deepest,
 *  most dealer-defended gamma and true daily 0DTE -- then mega-cap single names with high OI.
 *  Expanded from 14 to 30 names: the original 14 (indices + top mega-caps) plus 16 next-tier
 *  high-OI names. evaluatePinRegime already works on any ticker with UW GEX data -- widening
 *  the universe just lets the regime filter see more candidates. */
export const DEFAULT_PIN_UNIVERSE = [
  // Tier 1: index products (deepest gamma, true daily 0DTE)
  "SPX", "NDX", "SPY", "QQQ", "IWM", "DIA",
  // Tier 2: original mega-cap single names
  "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "GOOGL", "AMD",
  // Tier 3: next-tier high-OI names (added for broader PIN coverage)
  "NFLX", "CRM", "AVGO", "COST", "LLY", "JPM", "V", "MA",
  "UNH", "WMT", "PG", "JNJ", "HD", "ADBE", "INTC", "MU",
] as const;

/** Resolve the pin universe: env override (ZERODTE_PIN_UNIVERSE, comma-separated) else the default. */
export function resolvePinUniverse(): string[] {
  const raw = process.env.ZERODTE_PIN_UNIVERSE;
  if (raw && raw.trim()) {
    const list = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (list.length > 0) return list;
  }
  return [...DEFAULT_PIN_UNIVERSE];
}

/** Cap how many PIN setups are RETURNED per scan (board surface + merge budget). */
export const PIN_MAX_CANDIDATES = 16; // raised 8→16 with uncapped open-play desk (2026-07-29)
/** Cap how many tickers we EVALUATE (GEX + chain) before ranking — larger than the return cap so
 *  we pick the best regimes, not the first N list-order names (FINDINGS 2026-07-28). Condor-eligible
 *  roots are always included in the eval window first. */
export const PIN_EVAL_CAP = 20;

/** Injectable IO seam — real providers by default; tests substitute hermetic fakes (same shape as
 *  breakout-discovery.ts's `BreakoutDiscoveryDeps` / momentum-signal-discovery.ts's
 *  `MomentumDiscoveryDeps`). Only the two network-touching calls are injected — everything else
 *  (`evaluatePinRegime`, `pinPassesTemporalStabilityGate`, the condor builder) is already pure or
 *  self-gates off a disabled-by-default env flag, so it needs no seam to test hermetically. */
export type PinDiscoveryDeps = {
  fetchHeatmap: (ticker: string) => ReturnType<typeof fetchGexHeatmap>;
  resolveChain: (ticker: string) => ReturnType<typeof resolveTickerChainRows>;
};

const DEFAULT_PIN_DEPS: PinDiscoveryDeps = {
  fetchHeatmap: fetchGexHeatmap,
  resolveChain: resolveTickerChainRows,
};

/** See the file-header "FETCH-FAILURE-VS-GENUINE-EMPTY DISCLOSURE" note. A HIGH bar deliberately —
 *  this must separate a real, near-universal upstream outage from ordinary per-name flakiness. */
export const PIN_FETCH_FAILURE_RATE_THRESHOLD = 0.9;

/** Discriminated result of a PIN discovery pass (added 2026-11-09 alongside the fetch-failure
 *  disclosure fix above — previously this returned a bare `EnrichedZeroDteSetup[]`, which is why
 *  `status` only has two members today instead of breakout-discovery.ts's richer set: PIN's other
 *  "nothing to report" paths were already carved out by scan.ts's OWN `pinWindowStatus` check
 *  before this fix and still are — only the fetch-failure disclosure is new here). */
export type PinDiscoveryOutcome = {
  status: "ok" | "skip_fetch_failed";
  setups: EnrichedZeroDteSetup[];
  /** Present only when status === "skip_fetch_failed" — the last thrown fetch's own error message
   *  (free text, diagnostics only, never parsed as structured data — same convention as
   *  breakout-discovery.ts's `reason`). */
  reason?: string;
};

/** Calendar days between two YYYY-MM-DD dates (UTC-noon anchored) — local copy so this module
 *  doesn't reach into pin-source's private helper. */
function calendarDte(todayYmd: string, expiryYmd: string): number {
  const a = Date.parse(`${todayYmd}T12:00:00Z`);
  const b = Date.parse(`${expiryYmd.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/** Price the four condor legs off the chain: find the nearest usable expiry (0DTE preferred, within
 *  `maxDte`) on which ALL FOUR strikes are listed, and return each leg's live quote. Returns null when
 *  no single expiry lists all four legs — that is "condor geometry/liquidity unavailable", and the
 *  caller falls back to the directional fade. HORIZON INTEGRITY (PR-1, design Q2): `maxDte` is clamped
 *  to 1 so a condor is only ever priced on a same-day/1DTE expiry (SPX/NDX condors are cash-settled
 *  same-day and graded on the session's own minute bars) — never a 2–7DTE weekly. Pure over the rows. */
function priceCondorLegs(
  rows: PinChainRow[],
  legs: { short_put: number; long_put: number; short_call: number; long_call: number },
  todayYmd: string,
  maxDte = 1
): { expiry: string; dte: number; quotes: { shortPut: CondorLegQuote; longPut: CondorLegQuote; shortCall: CondorLegQuote; longCall: CondorLegQuote } } | null {
  // Group rows by expiry → strike → row (last write wins; a chain has one row per strike/expiry).
  const byExpiry = new Map<string, Map<number, PinChainRow>>();
  for (const r of rows) {
    const exp = r.expiry.slice(0, 10);
    const m = byExpiry.get(exp) ?? new Map<number, PinChainRow>();
    m.set(r.strike, r);
    byExpiry.set(exp, m);
  }
  const expiries = Array.from(byExpiry.keys())
    .map((exp) => ({ exp, dte: calendarDte(todayYmd, exp) }))
    .filter((e) => Number.isFinite(e.dte) && e.dte >= 0 && e.dte <= maxDte)
    .sort((a, b) => a.dte - b.dte); // 0DTE first, then 1DTE within the clamped same-day horizon
  for (const { exp, dte } of expiries) {
    const m = byExpiry.get(exp)!;
    const sp = m.get(legs.short_put);
    const lp = m.get(legs.long_put);
    const sc = m.get(legs.short_call);
    const lc = m.get(legs.long_call);
    if (!sp || !lp || !sc || !lc) continue; // some leg not listed on this expiry — try the next
    return {
      expiry: exp,
      dte,
      quotes: {
        shortPut: { bid: sp.put_bid, ask: sp.put_ask },
        longPut: { bid: lp.put_bid, ask: lp.put_ask },
        shortCall: { bid: sc.call_bid, ask: sc.call_ask },
        longCall: { bid: lc.call_bid, ask: lc.call_ask },
      },
    };
  }
  return null;
}

/** Build a priced CONDOR setup for one pin, or null to fall back to the directional fade. Reuses the
 *  backtested selectIronCondor geometry (short strikes at a target-80 width floor, pushed beyond the
 *  dealer walls) and prices the four legs off the same chain. Null when the geometry can't be selected
 *  or its legs aren't listed on a common expiry (liquidity unavailable). */
function buildCondorFromChain(input: {
  ticker: string;
  spot: number;
  regime: import("./pin-source").PinRegime;
  rows: PinChainRow[];
  today: string;
  callWall: number | null;
  putWall: number | null;
}): EnrichedZeroDteSetup | null {
  const { ticker, spot, regime, rows, today, callWall, putWall } = input;
  const legs = selectIronCondor({ spot, targetWinRate: 80, callWall, putWall });
  if (!legs) return null;
  const priced = priceCondorLegs(rows, legs, today);
  if (!priced) return null; // geometry not listed on a common expiry → directional fallback
  const plan = buildCondorPlan({ spot, expiry: priced.expiry, dte: priced.dte, legs, quotes: priced.quotes });
  return buildCondorSetup({ ticker, spot, regime, plan, score: pinScore(regime) });
}

/**
 * Discover PIN-origin setups for the live board. Returns a discriminated {@link
 * PinDiscoveryOutcome}: `ok` (setups may be empty — off-hours, a clean-pin miss, or simply no
 * ticker in the range/long-gamma regime are all genuine zeros) or `skip_fetch_failed` (90%+ of the
 * evaluated universe's own fetches THREW — see the file-header disclosure note). The source never
 * fabricates candidates. Best-effort throughout: any per-ticker failure degrades to a skip of that
 * ticker; a total failure degrades to an empty `ok` (or `skip_fetch_failed`, per the above) and the
 * flow board is untouched either way.
 */
export async function discoverPinSetups(opts: {
  today: string;
  nowEtMinutes: number;
  /** Tickers to exclude (static excludes + Night Hawk-covered names), same set the flow path uses. */
  excludeTickers: Set<string>;
  /** When set, ONLY these tickers are eligible — the 0DTE-desk-wide universe restriction
   *  (ticker-universe.ts), intersected with PIN's own curated universe. null/undefined means
   *  unrestricted (PIN's full curated list), same as before this option existed. */
  includeTickers?: Set<string> | null;
  maxCandidates?: number;
  deps?: Partial<PinDiscoveryDeps>;
}): Promise<PinDiscoveryOutcome> {
  const { today, nowEtMinutes, excludeTickers, includeTickers } = opts;
  const maxCandidates = opts.maxCandidates ?? PIN_MAX_CANDIDATES;
  const { fetchHeatmap, resolveChain } = { ...DEFAULT_PIN_DEPS, ...opts.deps };

  if (nowEtMinutes < RTH_OPEN_ET_MINUTES) {
    console.info("[zerodte-pin] before RTH open — SKIP (dealer-positioning read idle)");
    return { status: "ok", setups: [] };
  }
  const lateCondorOnly =
    nowEtMinutes >= RTH_CUTOFF_ET_MINUTES && nowEtMinutes < CONDOR_LATE_CUTOFF_ET_MINUTES;
  if (nowEtMinutes >= RTH_CUTOFF_ET_MINUTES && !lateCondorOnly) {
    console.info("[zerodte-pin] past condor late window — SKIP (dealer-positioning read idle)");
    return { status: "ok", setups: [] };
  }
  if (lateCondorOnly && !condorFlagEnabled()) {
    console.info("[zerodte-pin] past directional cutoff and CONDOR disabled — SKIP");
    return { status: "ok", setups: [] };
  }

  let universe = resolvePinUniverse().filter(
    (t) => !excludeTickers.has(t.toUpperCase()) && (!includeTickers || includeTickers.has(t.toUpperCase()))
  );
  if (lateCondorOnly) {
    // Post-14:00: only cash-settled index roots can still open (G-14 / persist CONDOR exemption).
    universe = universe.filter((t) => condorEligibleTicker(t));
  } else {
    // Condor-eligible roots first so SPX/NDX never fall out of a truncated env override list,
    // then evaluate up to PIN_EVAL_CAP and rank by score before returning top maxCandidates.
    const roots = universe.filter((t) => condorEligibleTicker(t));
    const others = universe.filter((t) => !condorEligibleTicker(t));
    universe = [...roots, ...others];
  }
  const evalCap = Math.max(maxCandidates, PIN_EVAL_CAP);
  universe = universe.slice(0, evalCap);
  if (universe.length === 0) {
    console.info("[zerodte-pin] pin universe empty after excludes — SKIP");
    return { status: "ok", setups: [] };
  }

  // Per-ticker result also carries whether EITHER IO call for this name actually THREW (never
  // whether it merely found nothing) — see the file-header disclosure note. Aggregated below to
  // decide ok vs skip_fetch_failed for the whole pass.
  type PinTickerResult = { setup: EnrichedZeroDteSetup | null; threw: boolean; errorMessage?: string };
  const built = await Promise.all(
    universe.map(async (ticker): Promise<PinTickerResult> => {
      let threw = false;
      let errorMessage: string | undefined;
      try {
        // Reuse the shared GEX matrix (cache-reader — never a second upstream). Cold matrix → skip.
        // 2026-11-09: was `fetchGexHeatmap(ticker).catch(() => null)`, which collapsed a THROWN
        // fetch onto the identical "no clean pin" outcome a genuinely cold/quiet matrix produces —
        // catch it ourselves so a throw is counted, not silently swallowed.
        let hm: Awaited<ReturnType<typeof fetchHeatmap>> = null;
        try {
          hm = await fetchHeatmap(ticker);
        } catch (err) {
          threw = true;
          errorMessage = err instanceof Error ? err.message : String(err);
          console.warn(`[zerodte-pin] ${ticker} GEX heatmap fetch THREW -- treating as a fetch failure, not "no pin":`, err);
        }
        const pos = gexPositioningFromHeatmap(ticker, hm);
        if (!hm || !pos || !(pos.spot > 0)) return { setup: null, threw, errorMessage };

        // Wall DOMINANCE from the SAME near-term-scoped ladder (computeGexWalls agrees with pos on
        // the top-wall strikes; we take the pct/share for the score's bracket-strength term).
        const walls = computeGexWalls(mapFromStrikeTotalsRecord(hm.gex.strike_totals), { spot: pos.spot });
        const callWallPct =
          pos.call_wall != null ? walls.callWalls.find((w) => w.strike === pos.call_wall)?.pct ?? null : null;
        const putWallPct =
          pos.put_wall != null ? walls.putWalls.find((w) => w.strike === pos.put_wall)?.pct ?? null : null;

        const regime = evaluatePinRegime({
          spot: pos.spot,
          callWall: pos.call_wall,
          putWall: pos.put_wall,
          callWallPct,
          putWallPct,
          gammaPosture: pos.gamma_posture,
        });
        if (!regime) return { setup: null, threw, errorMessage }; // not a clean pin — never fabricate a fade

        const temporal = await pinPassesTemporalStabilityGate(ticker);
        if (!temporal.ok) {
          console.info(`[zerodte-pin] ${ticker} temporal stability HOLD — ${temporal.reason}`);
          return { setup: null, threw, errorMessage };
        }

        // Pick the ATM fade contract off the live chain (call for a long/up fade, put for short/down).
        // 2026-11-09: was `resolveTickerChainRows(ticker).catch(() => null)` — same disclosure fix
        // as the heatmap fetch above, so a thrown chain fetch is counted, not silently swallowed.
        let chain: Awaited<ReturnType<typeof resolveChain>> = null;
        try {
          chain = await resolveChain(ticker);
        } catch (err) {
          threw = true;
          errorMessage = err instanceof Error ? err.message : String(err);
          console.warn(`[zerodte-pin] ${ticker} chain fetch THREW -- treating as a fetch failure, not "no pin":`, err);
        }
        if (!chain || !(chain.spot > 0) || chain.rows.length === 0) return { setup: null, threw, errorMessage };
        const rows: PinChainRow[] = chain.rows.map((r) => ({
          expiry: r.expiry,
          strike: r.strike,
          call_bid: r.call_bid,
          call_ask: r.call_ask,
          call_oi: r.call_oi,
          put_bid: r.put_bid,
          put_ask: r.put_ask,
          put_oi: r.put_oi,
        }));
        // ── Phase 4 CONDOR routing ──────────────────────────────────────────────────────────────
        // When the condor flag is on AND this deep long-gamma pin STRONGLY favors selling (tight,
        // dominant, centered — condorSellRegime), sell a defined-risk iron condor beyond the dealer
        // walls instead of fading directionally. If the condor geometry can't be selected or its four
        // legs aren't LISTED on a common expiry in the chain (liquidity unavailable), fall THROUGH to
        // the directional fade — the exact "stays 3b behavior when the condor isn't available" rule.
        // Assignment safety (gap #8): only sell condors on cash-settled index roots (SPX/XSP/NDX/RUT).
        // An American ETF/single-name short can be assigned early past the "defined loss" the grader
        // assumes, so those stay the directional fade until early-assignment is modeled.
        if (condorFlagEnabled() && condorEligibleTicker(ticker) && condorSellRegime(regime).sell) {
          const condorSetup = buildCondorFromChain({
            ticker,
            spot: chain.spot,
            regime,
            rows,
            today,
            callWall: pos.call_wall,
            putWall: pos.put_wall,
          });
          if (condorSetup) {
            return {
              setup: stampPinSetupPositioning(condorSetup, {
                gamma_posture: pos.gamma_posture,
                call_wall: pos.call_wall,
                put_wall: pos.put_wall,
                gex_king_strike: pos.gex_king_strike ?? null,
              }),
              threw,
              errorMessage,
            };
          }
        }

        // Past directional cutoff: never open a directional PIN fade — late window is CONDOR-only.
        if (lateCondorOnly) return { setup: null, threw, errorMessage };

        // Pick the ATM fade contract off the live chain (call for a long/up fade, put for short/down).
        const side = regime.fadeDirection === "long" ? "call" : "put";
        const contract = pickAtmPinContract(rows, chain.spot, today, side);
        if (!contract) return { setup: null, threw, errorMessage }; // no liquid same-day/weekly contract → shared plan gate would drop it

        return {
          setup: stampPinSetupPositioning(
            buildPinSetup({ ticker, spot: chain.spot, regime, contract, todayYmd: today }),
            {
              gamma_posture: pos.gamma_posture,
              call_wall: pos.call_wall,
              put_wall: pos.put_wall,
              gex_king_strike: pos.gex_king_strike ?? null,
            }
          ),
          threw,
          errorMessage,
        };
      } catch {
        // Best-effort per ticker — one bad read never sinks the batch. Deliberately NOT counted as
        // `threw` for the fetch-failure aggregate: this catches bugs elsewhere in this block (e.g.
        // a condor/fade-building error), not the two IO calls this fix tracks explicitly above.
        return { setup: null, threw: false };
      }
    })
  );

  const fetchFailures = built.filter((b) => b.threw).length;
  const fetchFailureRate = universe.length > 0 ? fetchFailures / universe.length : 0;
  if (fetchFailureRate >= PIN_FETCH_FAILURE_RATE_THRESHOLD) {
    const lastErrorMessage = [...built].reverse().find((b) => b.threw)?.errorMessage;
    console.warn(
      `[zerodte-pin] ${fetchFailures}/${universe.length} evaluated name(s)' own fetch THREW -- ` +
        `SKIP_FETCH_FAILED (not "no pins today")`
    );
    return {
      status: "skip_fetch_failed",
      setups: [],
      reason: lastErrorMessage ?? `${fetchFailures}/${universe.length} per-ticker fetches threw`,
    };
  }

  const setups = built
    .map((b) => b.setup)
    .filter((s): s is EnrichedZeroDteSetup => s != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, maxCandidates);
  if (setups.length === 0) {
    console.info(`[zerodte-pin] scanned ${universe.length} liquid name(s), no clean pin regime — SKIP`);
    return { status: "ok", setups: [] };
  }
  console.info(
    `[zerodte-pin] built ${setups.length} pin setup(s) from ${universe.length} evaluated name(s) (ranked by score)`
  );
  return { status: "ok", setups };
}
