# Night Hawk → "Best Trades Today, Any DTE" — Rails + Regime Redesign

**Date:** 2026-08-25. **Status:** design of record, Phase 1 scaffolding landing now.
**Supersedes nothing** — this extends `0DTE-UNIFICATION-DESIGN.md`'s already-shipped
origin-based discovery model (`DiscoveryOrigin` = `FLOW | BREAKOUT | PIN`, unioned by
ticker, never collapsed into one undifferentiated pool). That document's spine — fail-closed
gate stack, Cortex evidence model, governor, graded ledger, exit engine — is kept **verbatim**.
This document is about the *discovery/scoring* layer sitting on top of it, not a rewrite of the
infra underneath it.

## 0. Why now, and why this shape

Operator's own words: "I feel like it's not working well and we're not getting good plays ..
and very less number of plays .. i feel like something is off." Investigated live 2026-08-25:

- Root cause of the immediate scarcity was mechanical and already found — PR #2893 tightened
  `ZERODTE_SCORE_FLOOR_BREAKOUT`/`_PIN` (50→65) and added a new single-rail-corroboration gate
  (G-17, `ZERODTE_SINGLE_RAIL_PRIME_MIN=75`), live in prod, verified against the admin funnel
  (`score_floor` was 154–160 of 253–276 total `gate_blocked_events`). PR #2895 (targeted FLOW
  corroboration + score calibration) addresses the mechanical scarcity without lowering the
  quality bar — that is a tuning fix, not this redesign.
- The deeper complaint is structural, not tunable: **FLOW discovery ranks by premium across ALL
  tickers (limit 500, max_dte 1)**, so whole-market BREAKOUT names (mid-cap momentum) rarely
  appear in that head. Measured 2026-08-25: **29 BREAKOUT + 7 FLOW setups, 0 multi-rail merges**
  despite several shared mega-cap names. FLOW-first merge precedence (`INTENTIONAL-DESIGN.md`
  item #1) then means most tickers never get a second, corroborating vote — the board is
  effectively three loosely-related lists, not one ranked "best trades" surface.
- The 0DTE-only framing is also a self-inflicted ceiling: a genuinely strong setup on a 3-7 DTE
  contract is invisible to a board that only ever asks `deriveZeroDteSetups` about 0-1 DTE tape.

None of this is "the plumbing is broken" — `zerodte-e2e-healthcheck.mjs` stages A-G are GREEN
(commit/ledger, marks/P&L, exit coherence, grading arithmetic). It's "the plumbing is sound and
the thing it's plumbing is too narrow." That argues for keeping the spine and rebuilding the
discovery/scoring layer on top of it — which is exactly the shape `0DTE-UNIFICATION-DESIGN.md`
already established for FLOW/BREAKOUT/PIN. This redesign is that same pattern, generalized.

## 1. What's kept, unchanged

Everything in `0DTE-UNIFICATION-DESIGN.md` §0's "keep verbatim" list, plus the origin-union
merge mechanics already in `board.ts` (`DiscoveryOrigin`, `unionDiscoveryOrigins`,
`mergeSameTickerDiscovery`, `origin_direction_map`/`origin_score_map`/`direction_owner`,
`MERGE_POLICY_VERSION`). These were built generically over `readonly DiscoveryOrigin[]` and
`Partial<Record<DiscoveryOrigin, ...>>` — they do not need to change shape to support more
origins, only to have more origins defined. That is the load-bearing fact that makes this a
rail *addition*, not a rewrite: the merge/attribution machinery already treats "how many
independent sources voted, and did they agree" as first-class, graded data.

Also kept: calibration-first discipline (n≥10, WR-delta≥15pts before anything gates), the
graded ledger as the only source of truth on whether a change helped, and the standing rule
never to hand-tighten/loosen on a hunch — every rail below ships **evidence-only** until its own
origin-band graduates on real outcomes, exactly like `FLOW+BREAKOUT` vs `FLOW`-alone today.

## 2. The six rails

Each rail is an independent discovery source stamping its own `DiscoveryOrigin` value, run in
parallel, merged by ticker via the existing union mechanics — no rail is privileged in the type
system (FLOW's current de facto precedence in `mergeSameTickerDiscovery` is a policy choice,
versioned by `MERGE_POLICY_VERSION`, not a structural one, and stays revisitable per rail-vs-rail
graded evidence).

| Rail | Origin tag | Candidate source | Status |
|---|---|---|---|
| FLOW | `FLOW` | `fetchRecentFlows` → `deriveZeroDteSetups` (shipped) | keep |
| BREAKOUT | `BREAKOUT` | `screenBreakoutMovers` momentum re-rank (shipped) | keep |
| PIN | `PIN` | GEX-wall mean-reversion (shipped) | keep |
| MOMENTUM | `MOMENTUM` | price/VWAP/breadth trend-strength screen, DTE-agnostic (distinct from BREAKOUT's gain/volume/close-strength gate — this rail scores *persistence* of an existing trend, not a fresh breakout) | new, Phase 2 |
| REVERSAL | `REVERSAL` | counter-trend exhaustion screen (RSI/extension + volume climax) — the rail PIN's GEX-wall version doesn't cover for names with no clean dealer wall | new, Phase 2 |
| RELATIVE STRENGTH | `RELATIVE_STRENGTH` | sector/peer-relative outperformance (a name flat in isolation but leading its cohort) | new, Phase 2 |
| POSITIONING | `POSITIONING` | dealer/institutional positioning read distinct from PIN's wall-fade framing (options skew, OI concentration, dark-pool print bias) | new, Phase 2 |

**Phase 1 (this PR):** widen the `DiscoveryOrigin` type and every `Partial<Record<DiscoveryOrigin,
...>>` map to the full six-value union, with the four new rails wired as **no-op sources** (empty
candidate lists) so `unionDiscoveryOrigins`/`origin_direction_map`/calibration-report origin-band
slicing all already understand the new tags before a single line of new screener logic ships.
This is a pure type/scaffolding change — zero behavior change, verified by the existing
`board.test.ts` origin-merge tests passing unmodified.

**Phase 2+ (separate PRs, one rail per PR, calibration-first):** implement MOMENTUM, then
REVERSAL, then RELATIVE STRENGTH, then POSITIONING, in that order — each lands as evidence-only
(feeds the graded ledger, contributes to `origin_score_map`/`origin_direction_map`, does **not**
gate or boost score) until its own origin-band clears the same n≥10/WR-delta≥15pts bar every
other origin graduated on.

## 3. Regime engine (routes weight, not eligibility)

Per `0DTE-UNIFICATION-DESIGN.md` §1c, a regime signal (gamma sign, VIX band, wall geometry) already
exists and already routes directional-vs-condor play type. This redesign reuses it, not replaces
it: the regime read additionally informs which rails are *likely* to be productive right now
(e.g., PIN/POSITIONING in a long-gamma range tape; MOMENTUM/BREAKOUT in a trending, short-gamma
tape) — but per the calibration-first rule, this is a **ranking hint fed into evidence, never a
hard eligibility filter**. A rail is never silently excluded from running because the regime
engine guessed it wouldn't hit; that would reintroduce exactly the kind of undemonstrated static
cap `INTENTIONAL-DESIGN.md` item #4 already flagged as unproven (the discovery-recall-probe found
win rate does NOT decay with the thing the cap was gating on).

## 4. Archetype-based scoring (replaces flat tier score as the cross-rail ranker)

Today's tier score (`calibrateFlowEvidenceScore` et al.) was built for FLOW's own evidence shape
(premium tier, dominance, aggression) and doesn't generalize to "how good is this MOMENTUM
candidate vs this PIN candidate" — comparing raw tier scores across rails compares numbers that
were never calibrated against each other. The fix is an **archetype layer**: each rail's raw
score is first mapped to a small set of named archetypes (e.g. `institutional-accumulation`,
`momentum-breakout`, `mean-reversion-fade`, `relative-leader`) with its own calibration curve
against **that archetype's own graded outcomes** — never one global formula. Cross-rail ranking
then compares archetype-calibrated scores, which is an apples-to-apples comparison in a way raw
tier scores are not. This is new work, sequenced **after** Phase 1 scaffolding and **alongside**
each new rail's Phase 2 PR (an archetype only needs to exist once its rail does), not a
prerequisite that blocks rail rollout.

## 5. Cross-DTE contract engine (separate stage, built after rails 1-3 are live)

Per the operator's stated priority, this is explicitly sequenced **after** the six rails
(specifically: after FLOW/MOMENTUM/BREAKOUT/REVERSAL/RELATIVE-STRENGTH/POSITIONING are wired,
even if several are still evidence-only). Today's `buildContractPlan` is 0DTE-first with a weekly
fallback (`0DTE-UNIFICATION-DESIGN.md` §1b). The redesign generalizes this into a standalone
second stage that takes whatever the ranker surfaces (ticker + direction + archetype + regime)
and independently picks the *instrument* — 0DTE, weekly, or swing-dated — rather than the
discovery layer implicitly assuming 0DTE and falling back only on a liquidity failure. This
keeps `buildContractPlan`'s existing hard blocks (`plan_illiquid`/`plan_moved`/`plan_no_quote`)
verbatim; it only widens what DTE window it's allowed to search before applying them.

## 6. Sequencing (what ships in what order)

1. **Phase 1 (this PR):** `DiscoveryOrigin` type widened to 6 values, no-op sources wired,
   zero behavior change. Unblocks every later PR working independently.
2. **Phase 2a:** MOMENTUM rail, evidence-only.
3. **Phase 2b:** REVERSAL rail, evidence-only.
4. **Phase 2c:** RELATIVE STRENGTH rail, evidence-only.
5. **Phase 2d:** POSITIONING rail, evidence-only.
6. **Phase 3:** archetype-calibrated cross-rail ranker (once ≥2 new rails have enough graded
   history to calibrate an archetype curve against).
7. **Phase 4:** cross-DTE contract engine as a standalone second stage.

Each phase is its own small PR per the repo's standing issue-handling policy (one thing per
branch/PR, fix+test, verify CI green, merge). No phase gates member-visible behavior until its
graded evidence clears the standing n≥10/WR-delta≥15pts bar — so at every point in this rollout
the live board is at least as safe as it is today, and usually unchanged until a rail earns its
keep.
