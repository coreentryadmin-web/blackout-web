/**
 * Production-faithful KEPT/DROPPED cohort split for the BREAKOUT discovery harnesses.
 *
 * WHY THIS EXISTS (2026-08-06 audit): `discovery-recall-probe.mjs` and `breakout-dynamic-n-ab.mjs`
 * both split their cohorts with `screenBreakoutMovers(results, N).slice(0, KEEP)` — i.e. by
 * **$-volume rank**, because that is the order `screenBreakoutMovers` returns. Production has NOT
 * used that ordering since 2026-08-21 when gain-over-range ranking shipped: `runBreakoutDiscovery`
 * (`src/lib/zerodte/breakout-discovery.ts`) re-orders the screened pool with
 * `rankMoversForChainFetch(pool, fetchBudget, side)` — gain-over-range quality, gain/((h−l)/o) — and only THEN takes the cap.
 * The harnesses were therefore measuring a cohort split the live board never makes, which invalidated
 * the recall/dynamic-N evidence derived from them.
 *
 * This module is the single place that mirrors the production ordering + pool sizing, so the two
 * harnesses cannot drift apart from each other or from `breakout-discovery.ts` again.
 *
 * WHAT PRODUCTION DOES, in order (breakout-discovery.ts:295-379):
 *   1. screenPool   = max(BREAKOUT_MAX_CANDIDATES_CEILING * 4, BREAKOUT_SCREEN_POOL)   → 600
 *   2. longMovers   = screenBreakoutMovers(results, screenPool)      ($-volume-ranked, filtered)
 *      shortMovers  = screenBreakdownMovers(results, screenPool)
 *   3. qualifying   = longMovers.length + shortMovers.length         ← BOTH sides feed the cap
 *   4. cap          = resolveBreakoutCandidateCap({ qualifyingMovers: qualifying, floor, ceiling })
 *   5. fetchBudget  = min(max(cap * 4, 60), BREAKOUT_SCREEN_POOL)    → 60…200
 *   6. ranked<side> = rankMoversForChainFetch(<side>Movers, fetchBudget, side)   ← gain-over-range order
 *   7. fillSide walks `ranked` in batches of 8 and keeps the first `cap` names that successfully
 *      build a same-day contract.
 *
 * MODELLING NOTE (stated, not hidden): step 7's contract-build failures cannot be reproduced
 * offline (they need each name's live 0DTE chain). We model the BEST CASE — every name builds — so
 * KEPT = gain-over-range ranks 1…cap and DROPPED = gain-over-range ranks cap+1…pool end. That is the correct
 * comparison for a *recall* question ("what did the cap never look at?"): real build failures only
 * pull MORE of the dropped tail into the kept set, so the modelled kept cohort is the tightest
 * (most favourable-to-the-cap) reading of the split. Names beyond `fetchBudget` never get a chain
 * fetch under any circumstances; `fetch_budget` is returned so a harness can report that boundary.
 */

/** Production's per-scan chain-fetch budget (breakout-discovery.ts:378). Pure. */
export function productionFetchBudget(cap, screenPoolCap) {
  return Math.min(Math.max(cap * 4, 60), screenPoolCap);
}

/** Production's upstream screen-pool size (breakout-discovery.ts:295). Pure. */
export function productionScreenPool(ceiling, screenPool) {
  return Math.max(ceiling * 4, screenPool);
}

/**
 * Split one side's screened pool into the cohorts production actually forms.
 *
 * @param {object} args
 * @param {Array<{ticker:string,gain:number,close_strength:number,dollar:number}>} args.pool
 *        the side's screened qualifying pool, exactly as `screenBreakoutMovers`/`screenBreakdownMovers`
 *        returned it (i.e. still in $-volume order — this function does the momentum re-rank).
 * @param {number} args.cap          the per-scan candidate cap (`resolveBreakoutCandidateCap`).
 * @param {number} args.screenPoolCap `BREAKOUT_SCREEN_POOL` — bounds the chain-fetch budget.
 * @param {(movers:any[], maxKeep:number, side:"long"|"short") => any[]} args.rank
 *        the REAL production `rankMoversForChainFetch` (injected so this module stays pure/testable).
 * @param {"long"|"short"} [args.side="long"]
 * @returns {{ranked:any[], kept:any[], dropped:any[], fetch_budget:number, unfetched:any[]}}
 */
export function splitBreakoutCohorts({ pool, cap, screenPoolCap, rank, side = "long" }) {
  const fetchBudget = productionFetchBudget(cap, screenPoolCap);
  // Ask for the WHOLE pool so we get the complete momentum ordering; the production slice points
  // (cap, fetchBudget) are applied below rather than being baked into the rank call, so the probe
  // can see and grade what falls beyond each boundary.
  const ranked = rank(pool, pool.length, side);
  return {
    ranked,
    kept: ranked.slice(0, cap),
    dropped: ranked.slice(cap),
    fetch_budget: fetchBudget,
    // Names momentum-ranked below the chain-fetch budget: unreachable even if every name above
    // them failed to build a contract.
    unfetched: ranked.slice(fetchBudget),
  };
}
