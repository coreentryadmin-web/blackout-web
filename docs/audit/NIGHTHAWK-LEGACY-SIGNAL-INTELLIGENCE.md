# Night Hawk Legacy — Signal Intelligence & Quality (Phase 3 design)

> **Status: design + audit, not yet implemented.** This document is the deliverable for the
> operator's "next phase" directive (2026-09-17): move Legacy from infrastructure reliability
> (Phase 1/2, PR #5111) into decision-quality measurement — which signals actually precede good
> moves, which combinations matter, which are redundant, which regimes they work in — so Legacy
> can **rank** opportunities instead of merely **finding** activity.
>
> Nothing in this document has been implemented yet. No production ranking, threshold, gate, or
> published-play behavior has changed. Everything proposed here is designed to land first as
> **shadow evaluation** — instrumentation and a parallel ranking path that records what it *would*
> have selected, without ever touching what members see — per explicit operator instruction.

Audit method: five parallel research passes over the live pipeline (`src/features/nighthawk/lib/`)
plus the existing outcome-tracking/calibration infrastructure and prior audit history
(`docs/audit/nighthawk-legacy-live-journal.json`). All file:line citations below were verified by
direct reads against the current worktree; line numbers may drift a few lines as the pipeline is
touched — re-grep before editing.

---

## 1. Map of the current NIGHTHAWK decision pipeline

```
STAGE 1  MarketWideContext          fetchMarketWideContext()              edition-builder.ts:500-516
         (one shared market read all 7 discovery lanes consume)            market-wide.ts

STAGE 2  DISCOVERY (7 lanes)        extractMultiSourceCandidates()        candidates.ts:623-724
           flow / oi_change / unusual_trades / catalyst / predictions /
           movers / breakout — normalized 0..LANE_MAX, merged into one
           composite score, corroboration-bonus multiplied, confluence-
           gated (top 20 protected, rank 20+ needs ≥2 lanes) → **ticker
           strings only** (composite_score/sources/lane_scores discarded)
         Zero-candidate short-circuit → recap-only edition               edition-builder.ts:524-544

STAGE 3  DOSSIER / ENRICHMENT       fetchAllDossiers()                    dossier.ts:538-567
           batches of 2, ≤45s wall/ticker, 800ms inter-batch pacing.
           24 provider calls per ticker across 2 waves (14 + 10 pooled)
           → TickerDossier (positioning/technicals/flow/news/financials/
           dark-pool/greek-flow/congress/predictions/screener/…)

STAGE 4  SCORING                    scoreCandidate()                       scorer.ts:1004-1269
           12 additive sub-scores (flow/tech/positioning/news/smart-
           money/fundamental/short-interest/wall-proximity/vex/catalyst/
           IV-penalty/anomaly) → regime multiplier (clamped [0.6,1.3],
           dampened 50%) → total [0,100]. Tier/conviction assigned
           separately (points system, not score cutoffs)                  nighthawk-tiers.ts:117-212

STAGE 5  RANKING (5 sort passes)    rankCandidates → governor → bearish-  scorer.ts:1329-1346
           posture → deterministic-edition governor-adjusted sort →       cross-edition-governor.ts:81-210
           **final raw-score re-sort (governor-blind — see §3)**          bearish-posture.ts:33-98
                                                                            deterministic-edition.ts:899-906
                                                                            edition-builder.ts:1146-1149

STAGE 6  REJECTION / PUBLISH GATES  sector-cap → grounding → deterministic
           critic (score floor, direction-consistency, tier ceiling,       play-critic.ts:78-176
           thin-signal downgrade) → G-N1..G-N4 publish gates (band-       grounding.ts:221-441
           detached / target-unreachable / stale-quote / book-tape-       publish-gates.ts:41-458
           conflict) with promoteTopBlocked rescue → merit re-filter       edition-quality.ts:184-223

STAGE 7  PUBLISH                    finalPlays persisted, publish_context  edition-builder.ts:1216-1276
           pinned per play (decision-time geometry + score breakdown,     publish-context.ts
           the Legacy analogue of 0DTE's entry_context), full-pool score
           breakdown archived to nighthawk_scoring_history                 edition-builder.ts:188-210

STAGE 8  OUTCOME (next session)     resolvePendingNighthawkOutcomes()      play-outcomes.ts:650-693
           single next-day daily bar, target/stop touch vs session
           high/low, MID and FILL-EDGE return bases, decided-only WR      analytics.ts:551-689
```

Two candidate-generation engines exist in `candidates.ts`; only `extractMultiSourceCandidates`
(above) is wired into the edition pipeline — `extractCandidateTickers` is a legacy single-source
path still used by hunt-mode only, not the nightly build.

---

## 2. What is already strong

- **The publish-time pin already exists and is well-designed.** `publish_context`
  (`publish-context.ts`) is explicitly built as "the analogue of the 0DTE `entry_context`" —
  decision-time geometry (spot/ATR/entry-band/target/stop) computed from the *same in-memory
  dossier the edition published from*, never re-fetched or backfilled (an explicit "honesty rule"
  in the code). It's versioned (`PUBLISH_CONTEXT_VERSION=3`), fail-soft per play, and already
  feeds real calibration work (`debrief-aggregate.ts`).
- **Full-pool score archival already exists, not just published-play archival.**
  `nighthawk_dossiers_staging` → `nighthawk_scoring_history` (`edition-builder.ts:188-210`)
  captures `scoreCandidate()`'s full component breakdown for *every* candidate the nightly hunt
  considered, not only the 5 that got published — this is exactly the "every candidate, not only
  published plays" principle the operator asked for, already half-built. It archives the score
  breakdown; it does not yet archive the raw dossier or forward outcomes (see §5).
- **Absence-vs-negative-signal discipline is real and mostly consistent.** `positioning` (GEX/
  dealer context), `dark_pool`, and `greek_flow` all explicitly distinguish "upstream never
  answered" (→ `null`, scored as zero contribution) from "upstream answered, genuinely nothing
  there" (→ a real empty/neutral object) — with code comments citing the specific production
  incidents (fabricated `net_gex:0`, a stale "0 dark-pool prints" cache) that motivated the fix.
- **A calibration methodology already exists, is proven across three products, and has already
  run once against Legacy.** `scripts/audit/legacy-score-calibration.mjs` reuses
  `swing-score-calibration-eval.mjs` unchanged (quantile bucketing + Spearman rank correlation,
  with a `RANKS` / `INVERTED` / `SPREAD WITHOUT ORDER` / `FLAT` / `INSUFFICIENT DATA` verdict
  discipline that explicitly refuses to call a bare spread a ranking — a lesson baked in after
  `helix-score-signal.mjs` once mislabeled a scrambled 10.9pp spread as "SEPARATES"). First real
  Legacy result (2026-09-15, n=17 decided): inconclusive, correctly reported as such rather than
  forced into a verdict.
- **A live, tick-by-tick MFE/MAE-shaped tracker already runs in production** — `discord_live_state.
  peak_premium`/`trough_premium` (`legacy-live-sync.ts:195-198`), updated every live-sync tick for
  every open position, driving the trim/close Discord bot. It's the closest thing to real MFE/MAE
  Legacy has, and it's a live measurement, not a backtest reconstruction — it's just never wired
  into the outcome/grading layer (see §5).
- **The publish gates encode real, evidence-driven design decisions, not arbitrary thresholds** —
  e.g. `G-N2 target_unreachable` is deliberately promotable because *blocking* it once produced an
  all-5-blocked, zero-play edition; `G-N4 book_tape_conflict` was built specifically to close a gap
  where tape disagreement only nudged score (±6-8) and never vetoed. Both carry measured attrition
  numbers from the live journal, not guesses.
- **Regime awareness exists**, via `computeRegimeMultiplier` (VIX-IV-rank × tide × breadth ×
  composite-regime string, clamped and dampened) and a coarser book-level `bearish-posture` re-rank
  — a real foundation to extend, not a blank slate.
- **The Swing lane's `calibration-cache.ts` pattern is directly transplantable**: cron-computed
  distilled snapshot → long-TTL shared cache → *graduated-only* gated read (Wilson-95%-lower-bound
  + point-delta ≥15pt) → a brief section that renders **nothing** rather than caveated evidence when
  a bucket hasn't graduated. This is the cleanest existing model in the codebase for how a Legacy
  "this archetype/setup has a track record" surfacing feature should work once the data exists.

---

## 3. What is weak or unproven

### Two concrete, already-diagnosed bugs in the current ranking (not yet fixed — see §9 on why)

1. **The unusualness multiplier compares the wrong units** (`candidates.ts:680-688`, first flagged
   PR #4957, re-confirmed live-unfixed 2026-09-12 and again in this audit). It divides a
   *normalized* 0-28 lane-point value by a *real dollar* baseline (floored $75k), so the ratio is
   permanently ≤0.000373 and `unusualnessMultiplier`'s `clamp(ratio, 0.5, 3)` floors to 0.5× for
   every flow-touched candidate — unconditionally halving the score of the exact candidates the
   multiplier was built to reward. The older, unused `extractCandidateTickers` path computes this
   correctly (comparing two real dollar figures); the multi-source engine appears to have copied
   the pattern but grabbed the wrong map.
2. **The last sort members actually see is governor-blind** (`edition-builder.ts:1146-1149`, "PR-
   N26"). Five sort passes touch the candidate list; two of them (the cross-edition governor's own
   sort, and the deterministic-edition sort feeding `groundPlays`) correctly order by
   `score − govPenalty`. The *final* sort — the one whose order members actually see — re-sorts by
   raw `.score`, ignoring `govPenalty` entirely. A ticker the governor demoted for a loss-streak or
   sector-concentration violation can be re-promoted to rank #1 in the published order. It doesn't
   undo the governor's earlier *cuts* (those candidates are already gone) — only its *ordering* of
   whichever penalized survivors made it through.

Both are implementation bugs (the code doesn't do what its own surrounding logic and comments say
it should), not judgment calls about what to weight — but fixing either changes published ranking
order, which is why they're reported here rather than fixed. See §9.

### Structural weaknesses in outcome measurement (the core gap this whole initiative addresses)

- **Grading is single-shot, single-session, single-daily-bar.** `resolvePendingNighthawkOutcomes`
  pulls exactly one next-day daily OHLC bar per play. No MFE/MAE walk, no intraday checkpoints, no
  multi-session tracking. Win/loss is decided by whether the daily high/low touched target/stop
  within one session.
- **The single biggest measured signal-quality problem in Legacy today is a grading-window
  artifact, not a signal-quality one.** A live, parked finding
  (`knownOpenItems.geometryWinRateGap_2026-08-06` in the journal, re-measured 2026-09-10, 60-day
  window): of 124 graded plays, `wrong_direction=49` + `target_unreachable=41` = **90/124 (73%)**
  are "structurally undecided by design" — the 1-session window simply wasn't long enough to reach
  target *or* stop — leaving only **2 real wins** in the sample. The current binary outcome mostly
  measures "was the session window long enough," not "was the signal directionally correct." A
  richer, multi-horizon outcome layer is not a nice-to-have here — it's necessary to even ask the
  question the operator wants answered.
- **Calibration is real but thin.** The one Legacy calibration run to date (n=17 decided) is well
  below this codebase's own established n≥30 reliability bar (used consistently by the Helix/Swing
  sibling tools) — correctly reported as inconclusive, not stretched into a false conclusion. The
  outcome layer proposed in §6-7 is partly *for* growing this sample faster (by grading every
  candidate, not just the 5 published nightly) and partly for making each sample count more (via
  richer per-candidate outcome data).
- **No forward-return measurement at multiple horizons exists anywhere in Legacy.** The closest
  sibling patterns (0DTE's `zerodte-sim.mjs --grade` MFE/MAE minute-bar walk, `helix-score-signal.
  mjs`'s fixed-horizon nearest-bar lookup) are real, working, reusable primitives — just never
  applied to Legacy or generalized to a multi-horizon grid.
- **`OUTCOME-GRADING-SPEC.md` and `INTENTIONAL-DESIGN.md` have zero Legacy-specific content.**
  Every "legacy" string hit in `OUTCOME-GRADING-SPEC.md` is a homonym (0DTE's pre-WS10 rows), not
  the Legacy product. This is documentation green-field, not a gap in an existing spec.
- **The tier/conviction narrative text is a one-time, never-recalibrated historical measurement.**
  `nighthawk-tiers.ts:156`'s "B-tier ran +2.99% avg" string is dated 2026-07-17 and has not been
  re-verified since; the one calibration run that exists neither confirms nor refutes it.
- **A known governor gap**: `loss-streak-halt` matches on ticker alone, ignoring direction — a
  ticker that stopped out twice as a SHORT halts a later LONG on the same name too.

---

## 4. Data we're collecting but underusing

From the dossier/enrichment audit, diffing every `TickerDossier` field against what
`scoreCandidate`'s `dossierExtras` object actually reads:

| Field | Collected via | Currently used for |
|---|---|---|
| `iv_term` (IV term-structure curve) | `fetchUwIvTermStructure` | Narrative text only (`format.ts:383-390`) — never scored |
| `realized_vol` | `fetchPolygonRealizedVol`/`fetchUwRealizedVol` | Narrative only (`format.ts:391`) — IV *rank* is scored, realized vol is not, despite both being fetched |
| `flow_by_expiry` | `fetchUwFlowPerExpiry` | Narrative only (`format.ts:410-416`) |
| `screener_confirmed` | `fetchUwScreenerStocks` (a whole edition-wide shared UW pull exists just for this) | Narrative only (`format.ts:459-461`) — never touches score |
| `analyst_summary`/`price_target` (derived strings) | Benzinga PT | Narrative only — the underlying PT *object* does feed a score nudge, but the strings themselves don't |
| `sector` | `fetchPolygonTickerDetails` | Narrative + a hunt-mode prefilter; `ScoredCandidate.sector?` is a declared-but-never-populated dead type field |
| `polygon_sentiment` | Polygon news insights | Partially folded into `news_headlines`, otherwise narrative only |

Also: **`discord_live_state.peak_premium`/`trough_premium`** (§2) is real, live, tick-by-tick MFE/
MAE data that exists and is *actively used* — but only by the Discord trim/close bot, completely
disconnected from `analytics.ts`/the outcome-record layer. This is the single highest-leverage
"already have it, just wire it up" item in this whole audit.

And **`nighthawk_dossiers_staging`/`nighthawk_scoring_history`** (§2) already captures a score
breakdown for every considered candidate, every night — a resource that could already answer some
"which signals correlate with selection" questions today, just not yet joined to forward outcomes.

---

## 5. Data we need but currently lack

- **Forward price/outcome data at multiple horizons, for every considered candidate** (not just
  published plays). Nothing today grades a candidate the discovery/scoring stage touched but never
  published — so "are we rejecting candidates that subsequently perform well?" is currently
  unanswerable from persisted data.
- **A full raw-dossier point-in-time snapshot per candidate.** `publish_context` pins geometry +
  score breakdown + catalyst booleans for *published* plays; `nighthawk_scoring_history` pins the
  score breakdown for *every* candidate — but neither currently re-embeds the raw dossier itself
  (flow rows, dark-pool prints, news text, IV term curve, etc.). Without this, a future "which
  signal combinations mattered" analysis can only reason from already-computed sub-scores, not from
  the underlying evidence those sub-scores were computed from.
- **`earnings_date`/`today_ymd`/`tomorrow_ymd` in the main dossier build path.** `scoreCandidate`
  supports an earnings-risk flag, but `fetchTickerDossier`'s own call never passes these fields —
  only the separate hunt-mode `rescoreDossier` path does. In the primary nightly pipeline,
  `earningsRisk` is always `false`. This looks like an unintentional gap between the two call
  sites, not a documented design choice.
- **A regime CLASSIFIER, not just a regime MULTIPLIER.** The current mechanism produces one
  continuous adjustment factor; there is no discrete regime label (trending/ranging/high-vol/
  low-vol/event-driven/earnings-week/FOMC-CPI-week/risk-on/risk-off) persisted alongside each
  candidate's outcome, so "does signal X work better in regime Y" cannot be asked directly today —
  it would have to be reconstructed after the fact from raw VIX/tide/breadth history, the same way
  `swing-gate-compound-funnel.mjs`/`swing-loss-taxonomy-segment.mjs` already do for the Swing lane.
- **DTE/liquidity/spread context on the CONTRACT actually considered**, captured at decision time —
  today's dossier is underlying-centric; the contract-level pick (strike, DTE, spread) is decided
  later in `deterministic-edition.ts` and isn't looped back into a per-candidate snapshot.
- **A genuine out-of-sample evaluation harness.** Every existing calibration tool in this codebase
  measures one historical window; none currently hold out a forward period to test whether a
  measured pattern (e.g. a score-quantile edge) persists on data the tool hasn't seen yet.

---

## 6. Proposed outcome/journal schema

Extend, rather than replace, the two existing pinning mechanisms — this is additive to
`publish_context`/`nighthawk_scoring_history`, not a parallel system.

**`nighthawk_candidate_snapshot`** (new table, or a new JSONB column added to
`nighthawk_scoring_history` — implementation detail to settle during build) — one row per
candidate per edition, written at STAGE 7 for *every* candidate that reached scoring (published or
not), versioned like `publish_context` (`schema_version`):

```
{
  schema_version: 1,
  edition_for: "2026-09-17",
  ticker: "NVDA",
  decided_at: "2026-09-17T21:35:00Z",       // exact moment this candidate's dossier was frozen
  selected_for_publish: false,               // was this one of the 5?
  rejection_reason: "sector_concentration_cap" | "book_tape_conflict" | ... | null,

  // Point-in-time market state (never re-derived later — frozen at decision time)
  underlying: { price, prior_close, atr14, vwap, rel_volume },
  contract:  { occ, strike, expiry, dte, side } | null,   // null if never reached contract selection
  liquidity: { spread_pct, oi, volume } | null,

  direction: "long" | "short",
  regime: {                                   // discrete label, not just the multiplier
    composite: "trending" | "ranging" | "volatile" | "crisis" | "unknown",
    vix_iv_rank, tide, breadth_pct_advancing,
    event_window: "earnings" | "fomc" | "cpi" | null,
  },

  // The full raw evidence, not just its score contribution
  technical_structure: { trend, setup_tags, support_resistance, rsi14, ema_stack },
  options_flow: { flows_summary, strike_stacks, flow_streak },
  unusual_activity: { dark_pool, oi_change, greek_flow_summary },
  volatility_context: { iv_rank, iv_term, realized_vol, risk_reversal_skew },
  dealer_gamma_context: positioning,          // null when genuinely absent, never fabricated
  dark_pool: dark_pool_snapshot,
  news_catalysts: { headlines, catalysts, fda_events, sentiment },
  market_sector_confirmation: { sector, screener_confirmed, institutional_activity, congress },

  // Every NIGHTHAWK component score/reason (the existing scoreCandidate breakdown, unchanged shape)
  scoring: {
    total, tier, conviction,
    components: { flow, tech, positioning, news, smart_money, fundamental,
                  short_interest, wall_proximity, vex, catalyst, iv_adjustment,
                  anomaly_penalty, flow_conviction_bonus },
    regime_multiplier, regime_adjustment,
    governor_penalty, ranking_score,
  },

  // Populated later, once outcomes resolve — never backfilled with post-hoc "current" data
  outcomes: {
    horizons: {
      "5m":  { underlying_ret_pct, contract_ret_pct | null, mfe_pct, mae_pct } | null,
      "15m": { ... } | null,
      "30m": { ... } | null,
      "1h":  { ... } | null,
      "eod": { ... } | null,
      "next_session": { ... } | null,          // the existing grading window, kept for continuity
    },
    time_to_target_min: number | null,
    time_to_invalidation_min: number | null,
    thesis_still_valid_at: { "1h": bool, "eod": bool } | null,   // did the ORIGINAL reasons still hold
    resolved_at: iso8601 | null,
  },
}
```

Design principles carried over from the existing `publish_context`/Largo-contract conventions
(deliberately, not incidentally):

- **Additive, never flattening.** This wraps the existing `scoring` breakdown; it doesn't replace it.
- **Absence is honest.** Every optional block is `null` when genuinely unavailable, never a
  fabricated neutral value — same discipline `positioning`/`dark_pool`/`greek_flow` already follow.
- **Frozen, not re-derivable.** Everything above `outcomes` is written once, at decision time, from
  the in-memory dossier/score the edition actually used — never re-fetched later. This is what
  prevents look-ahead bias: a query run six months from now against this table sees exactly what
  the system saw that night, not what's true today.
- **`outcomes` is the only block written more than once**, by a separate grading pass (§7), strictly
  additive (new horizon keys filled in as they resolve) and append-only.

---

## 7. Proposed shadow-ranking architecture

The operator's own framing is the spec: run the existing system and a proposed alternative
**simultaneously**, record what each would have selected, compare on real forward data, change
nothing production-facing until the comparison says so.

```
                         ┌─────────────────────────────┐
STAGE 1-4 (unchanged) →  │  scoreCandidate() per ticker │  → ScoredCandidate[]
                         └──────────────┬──────────────┘
                                        │
                         ┌──────────────┴──────────────┐
                         │                              │
                  PRODUCTION PATH                 SHADOW PATH(S)
                  (STAGE 5-8, unchanged,          (new, side-effect-free
                   exactly as today)               ranking function(s))
                         │                              │
                  finalPlays published            shadow_picks[variant]
                  (members see this)               (nobody sees this)
                         │                              │
                         └──────────────┬───────────────┘
                                        ▼
                      nighthawk_candidate_snapshot (§6)
                      — every candidate, tagged by which
                        variant(s) selected it, all scored
                        identically by the SAME outcome layer
                                        │
                                        ▼
                         Forward-outcome grading (§6/§8)
                         — multi-horizon, MFE/MAE, real bars
                                        │
                                        ▼
                    Comparison report: production's Top-5
                    vs. each shadow variant's Top-5, on
                    real, out-of-sample forward outcomes
```

**Shadow variants to run from day one** (each is a pure function over the same
`ScoredCandidate[]` STAGE 4 already produces — no new data collection needed to start):

1. **`shadow_bugfix`** — production ranking with the two known bugs (§3) corrected. This is the
   cheapest possible shadow variant and directly answers "does fixing these actually help" before
   anyone touches production.
2. **`shadow_regime_aware`** — per-regime sub-score reweighting instead of one global multiplier
   (e.g. up-weight `wall_proximity`/`vex` in low-vol/ranging regimes, up-weight `flow`/`news` in
   event-driven windows) — an actual test of the operator's "one universal weighting scheme is not
   optimal" hypothesis, not just an assertion of it.
3. **`shadow_calibrated_confidence`** — replaces the raw `total` score with a calibrated probability
   derived from the quantile-bucket win rates §8's calibration tooling produces, once enough
   samples exist (bootstraps off the existing `legacy-score-calibration.mjs` methodology).

Each shadow variant runs in the SAME process, in the SAME edition-build request, reading the SAME
frozen dossiers — it costs CPU only, no extra network calls, no extra rate-limiter pressure, and
writes only to `nighthawk_candidate_snapshot`. **It never touches `finalPlays`, `publish_context`,
governor state, sector caps, or anything a member or the publish pipeline reads.** This is the
concrete mechanism that satisfies "do not silently change current production rankings... yet."

**"NIGHTHAWK TOP OPPORTUNITIES" output shape** (the target format, produced identically from
either the production path or a shadow variant once one is promoted — this is a rendering concern,
not a new ranking mechanism):

```
Candidate: NVDA · LONG · confidence 71% (calibrated, n=142 similar setups)
Setup: breakout + dark-pool call accumulation, confirmed by 3 independent lanes
Supporting evidence: sweep-heavy flow (score contribution shown per sub-score),
  price above VWAP/EMA20/50, dealer positioning aligned (gamma flip below spot)
Conflicting evidence: IV rank 78 (pricing-risk penalty applied), no institutional
  ownership confirmation this window
Catalyst: earnings in 9 days (outside binary-risk window)
Liquidity: spread 1.2%, OI 4,200 — clears the liquidity floor
Invalidation: close back below $X (prior support) OR gamma flip crosses above spot
Why it outranked #6 (AMD): 2 more confirming lanes, no book/tape conflict, AMD's
  target was outside 2×ATR14 (flagged target_unreachable, promoted on score alone)
```

The "why it outranked" line and "conflicting evidence"/negative-evidence surface are new rendering
work on top of data STAGE 4-6 already computes (`factor_breakdown`, gate verdicts, governor
penalties) — nothing here requires new scoring logic, only exposing what's already computed but
currently discarded before the member-facing narrative is built.

**Negative-evidence / do-not-surface list**: today, a candidate that fails a gate simply doesn't
publish — there's no member-facing (or even internal-debug-facing) "here's what we considered and
explicitly rejected, and why" surface. `nighthawk_candidate_snapshot`'s `rejection_reason` field
(§6) is exactly this — populated for every non-published candidate — and a shadow-mode report can
render it directly (e.g., "AXTI: attractive flow score but target unreachable within 2×ATR — not
surfaced").

---

## 8. Metrics to prove whether NIGHTHAWK is improving

All of the following reuse the existing, proven verdict discipline (`swing-score-calibration-eval.
mjs`'s quantile-bucket + Spearman-ρ + named-verdict pattern) rather than inventing a new one — this
codebase has already learned, twice (Helix's scrambled-spread mislabel, Swing's own ρ=0.559 near-
miss), that a spread alone is not evidence of a ranking.

- **Calibration**: score-quantile buckets → win rate per bucket, `RANKS`/`INVERTED`/`SPREAD WITHOUT
  ORDER`/`FLAT`/`INSUFFICIENT DATA` verdict (min-n discipline enforced, buckets below the floor
  named and excluded, never silently dropped).
- **Precision/recall/false-positive rate**, evaluated against MULTIPLE outcome definitions
  (per the operator's explicit instruction not to pick one arbitrary threshold) — e.g. "favorable
  move within 1h," "favorable move by EOD," "MFE ≥2× MAE within 4h," each reported separately, not
  collapsed into one number.
- **Expectancy/distribution** per signal, per signal-combination, per regime — mean and full
  distribution of forward return, not just win rate, once the multi-horizon MFE/MAE data exists.
- **Incremental information value**: does adding signal X to a base model actually improve
  calibration/ranking (compare ρ and bucket separation with vs. without), directly answering "which
  signals add no incremental information."
- **Stability across out-of-sample periods**: rolling-window re-evaluation (train on one window,
  test on the next, repeat) — the one genuinely new methodological piece none of the existing
  calibration tools do yet (§5's "out-of-sample harness" gap). Report whether a measured edge
  persists or was a fit to noise.
- **Shadow-vs-production comparison**: for each shadow variant, the same calibration suite run
  separately on (a) what production picked and (b) what the shadow variant picked, on the SAME
  forward outcome data — the direct answer to "is the new ranking measurably better," not an
  inference from a single aggregate number.
- **Latency instrumentation** (the operator's explicit "a strong setup arriving too late is not a
  strong output" point): age of every major input at decision time (dossier field freshness vs.
  fetch time), and discovery→enrichment→scoring→ranking→publish wall-clock, extending Phase 1's
  existing `queue_wait_ms`/`[api-queue-timing]` telemetry (PR #5111) up the stack rather than
  building parallel instrumentation.

Sample-size discipline: this codebase's own established floor is n≥30 for a calibration verdict to
be trusted (Helix/Swing tooling); Legacy is currently far below that (n=17 decided plays measured).
Grading every candidate (not just the 5 published nightly) via §6/§7 is the direct lever to grow
usable sample size faster than waiting on published-play volume alone.

---

## 9. Prioritized implementation plan

Every phase below ships as small, isolated, independently-reviewable commits/PRs, per instruction —
no phase merges, deploys, or undrafts without explicit operator approval, and no phase changes
production ranking/threshold/gate/publish behavior.

**Phase 0 — separate, unrelated track (not blocking anything below):**
The two disclosed Phase-2 cancellation gaps (`fetchUwPredictionsConsensus`'s internal fan-out; the
8 Polygon/Benzinga-backed dossier fields). Fully scoped by this audit (file:line, exact fix shape,
per-function risk level) — see the companion scoping report. Split into its own small PRs, ordered
by risk: (a) the fan-out fix + the 3 trivial single-call Polygon passthroughs
(`fetchPolygonNews`/`fetchPolygonTickerDetails`/`fetchShortInterest`) — mechanical, no coalescing
risk; (b) `buildTechnicalCard`'s 15+ call-site threading — mechanical but large blast radius, own
PR; (c) `fetchFinancialsBundle`/`fetchBenzingaCatalysts` — mechanical but needs `serverCache`'s
in-flight-coalescing behavior verified first (same class of risk PR #5111's `CoalescedAbortGroup`
was built to solve); (d) `fetchPositioningSummary` and `fetchTickerFlowStreak` — deferred further,
the former needs its own coalescing-aware design, the latter isn't an HTTP call at all (raw
Postgres — no native `AbortSignal` path).

**Phase 1 — foundation (no ranking logic touched):**
1. `nighthawk_candidate_snapshot` schema/migration + write-wiring at STAGE 7 for every scored
   candidate (published or not) — extends, doesn't replace, `nighthawk_scoring_history`.
2. Populate `earnings_date`/`today_ymd`/`tomorrow_ymd` in the main dossier build path (currently
   only hunt-mode has this) — a pure data-completeness fix, not a ranking change, since
   `earningsRisk` already exists as a scored dimension and is simply never triggered today.
3. Wire `discord_live_state.peak_premium`/`trough_premium` into the resolved-outcome row — the
   highest-leverage, lowest-cost item in this whole plan (data already collected, already live,
   just never read by the grading layer).
4. Multi-horizon forward-return grading: generalize `helix-score-signal.mjs`'s `barAt()` nearest-
   bar-at-offset primitive to loop over `[5m, 15m, 30m, 1h, EOD]` against real Polygon minute bars,
   reusing `zerodte-sim.mjs`'s MFE/MAE-walk pattern for the excursion fields — as an offline/cron
   grading pass writing into `outcomes`, not inline in the request path.

**Phase 2 — measurement (uses Phase 1's data, still no ranking change):**
5. Extend `legacy-score-calibration.mjs`'s methodology to per-regime/per-sector/per-DTE
   segmentation and multiple outcome definitions (§8), now with a real sample-size lever (every
   candidate graded, not just published plays).
6. Build the out-of-sample rolling-window harness (§8) — the one genuinely new methodological piece.
7. First real answer, from data rather than assertion, to: are the two known bugs (§3) actually
   costing win rate? (Compare `shadow_bugfix`'s picks against production's on identical forward
   data — this is also Phase 3's first deliverable, listed here because it's cheap enough to run
   before Phase 3's full harness exists, on historical `nighthawk_scoring_history` rows alone.)

**Phase 3 — shadow ranking (§7):**
8. `shadow_bugfix` variant — cheapest, most direct test of the two known bugs.
9. Comparison reporting tool (production Top-5 vs. shadow Top-5 on real forward outcomes, same
   verdict discipline as §8).
10. `shadow_regime_aware` and `shadow_calibrated_confidence` variants, once Phase 2's calibration
    data is rich enough to inform them (calibrated-confidence specifically depends on Phase 2's
    quantile buckets existing with real samples).

**Phase 4 — only with explicit operator sign-off, only once §8's metrics support it:**
11. Promote a shadow variant's actual ranking logic into production (this is the ONLY phase that
    changes what members see) — and even then, as a small, isolated, reviewable diff against the
    specific bug/weighting it fixes, not a wholesale ranking rewrite.
12. Retire the single-daily-bar-only grading window in favor of the multi-horizon one as the
    primary win/loss definition, if the data supports doing so — this directly addresses the
    `geometryWinRateGap` finding (§3) that the current binary outcome is mostly measuring window
    length, not signal correctness.

Documentation debt to close alongside Phase 1-2: add a Legacy section to `OUTCOME-GRADING-SPEC.md`
(currently zero Legacy content) and `INTENTIONAL-DESIGN.md` (single-daily-bar grading window,
fillability/unfilled exclusion, same-bar-tiebreak-toward-stop, mid-vs-fill-edge dual reporting all
deserve "what measurement would justify revisiting" entries, same as every 0DTE/Swing decision in
that doc already has).

---

## 10. Remaining risks and assumptions

- **Sample size will stay thin for a while even with every-candidate grading.** Legacy runs once
  per session day; even grading the full ~15-90-ticker candidate pool nightly instead of 5 published
  plays grows the sample materially faster, but genuinely regime-segmented or signal-combination-
  segmented buckets will still take months to reach this codebase's own n≥30 bar. Early shadow-vs-
  production comparisons must be read with the same caution this codebase already applies to every
  other thin-sample calibration result (explicitly labeled "first look, not a verdict").
- **Look-ahead bias is the central risk of this whole initiative**, and the mitigation is structural,
  not procedural: `nighthawk_candidate_snapshot` must be written from the SAME in-memory dossier the
  edition build used, at decision time, exactly like `publish_context` already does — never
  reconstructed later from "current" data. Any historical backfill attempt (rather than
  going-forward capture) would need extreme care and is NOT recommended as a shortcut to more data.
- **The shadow-ranking harness itself must be provably free of production side effects.** Running
  extra scoring logic inside the same request that builds the real edition adds CPU cost and
  surface area for a bug to leak into `finalPlays`; this needs its own test coverage proving
  read-only isolation (the same rigor PR #5111's `coalesced-abort-group.ts` tests apply to a
  different isolation property), not just a code-review assumption that "it only writes to a
  different table."
- **The two known ranking bugs (§3) are real but fixing them is a production-ranking change**, which
  the operator's instruction explicitly holds. They're reported as high-confidence, ready-to-fix
  candidates for the operator's judgment call — not fixed unilaterally in this pass, and not
  something this audit is treating as obviously in-scope for a "just fix it" CARVE-OUT, since
  fixing either would silently change which candidates get promoted or how they're ordered, exactly
  what "do not silently change current production rankings" rules out until proven via shadow data.
- **Multi-horizon intraday grading needs real Polygon minute-bar history and rate-limit budget.**
  This shares the same shared UW/Polygon rate-limiter infrastructure PR #5111 just hardened — the
  grading cron should run off-peak / batched, not compete with live discovery/dossier traffic during
  RTH.
- **`serverCache`/`withServerCache`'s in-flight-coalescing behavior (Phase 0, item (c) above) is not
  yet fully traced** — flagged as needing verification before wiring a signal through it, same
  caution PR #5111 already had to apply to `uwCacheGet`/`throttleUwCoalesced`.
- **A calibrated-confidence score is only as good as the calibration data behind it** — `shadow_
  calibrated_confidence` (§7) should not ship (even in shadow mode) with a fabricated confidence
  number before Phase 2's buckets have real samples; until then it should read as `null`/absent per
  this codebase's own "confidence must be omitted when a product cannot calibrate it" principle
  (Largo product contract), not a guessed number.
- **This document itself will go stale.** Per this repo's own standing practice, a future session
  reading this should re-verify every finding against current code (`git log`/`git show`) rather
  than trusting this snapshot at face value — several of the audits that informed sibling documents
  in this codebase (`FINDINGS.md`, `nighthawk-legacy-live-journal.json`) were themselves caught going
  stale within the same session that wrote them.

---

## Appendix: source audit citations

Full file:line detail for every claim above lives in the five research passes this document
synthesizes (discovery lanes, dossier/enrichment, scoring/ranking/gates, existing outcome infra,
cancellation-gap scoping) — available in this session's transcript; key files re-cited here for a
future reader without that transcript:

`src/features/nighthawk/lib/candidates.ts`, `edition-builder.ts`, `dossier.ts`, `scorer.ts`,
`nighthawk-tiers.ts`, `cross-edition-governor.ts`, `bearish-posture.ts`, `deterministic-edition.ts`,
`play-critic.ts`, `grounding.ts`, `publish-gates.ts`, `edition-quality.ts`, `publish-context.ts`,
`play-outcomes.ts`, `analytics.ts`, `legacy-live-sync.ts`, `flow-streak.ts`, `positioning.ts`,
`technicals.ts`; `scripts/audit/legacy-score-calibration.mjs`,
`scripts/audit/lib/swing-score-calibration-eval.mjs`, `scripts/audit/swing-score-calibration.mjs`,
`scripts/audit/helix-score-signal.mjs`, `scripts/audit/lib/helix-score-eval.mjs`,
`scripts/audit/zerodte-sim.mjs`, `scripts/audit/market-banger-scan.mjs`,
`scripts/audit/swing-early-trim-ab.mjs`, `src/lib/swing/calibration-cache.ts`,
`src/lib/swing/play-brief-intel.ts`; `docs/audit/OUTCOME-GRADING-SPEC.md`,
`docs/audit/INTENTIONAL-DESIGN.md`, `docs/audit/nighthawk-legacy-live-journal.json`.
