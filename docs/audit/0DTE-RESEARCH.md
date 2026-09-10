# 0DTE & Whole-Market Banger — Research Map + Plan
_Living, evidence-driven analysis. Every claim ties to a real experiment (Polygon minute/daily bars +
UW flow) or a code ref. Method: run the REAL pipeline over REAL data; measure EXPECTANCY, not just
win-rate. Rigor rule: validate wide (≥20 sessions) before trusting — small samples lie._

> **The one-line thesis.** No single lever is a money machine. Edge = **CONFLUENCE × TIMING ×
> EXITS × REGIME**, proven on the ledger. Two engines on one confluence spine: an **index/ETF 0DTE
> grinder** (consistent +EV) and a **whole-market weekly BANGER** engine (asymmetric 3–20x). Finding
> setups is easy; **exiting them is the edge.**

---

## Part 1 — 0DTE index/ETF grinder (SPY/QQQ/IWM/SPX)

### Experiments run
| # | Experiment | Sessions | Result |
|---|---|---|---|
| E1 | Multi-day (d=5) vs single-day (d=1) accumulation as discovery | 5 | **Wash** — 32% vs 36% WR, n≈30. No standalone edge for lookback window. |
| E2 | Entry-time × strike × stop/target geometry sweep | 7 → **25** | 7-session screamed "+43% EV @ 11:00"; **25-session corrected to +1.5%.** (Overfit caught.) |
| E3 | Confluence: 0/1/2 confirmations (VWAP-side + SPY-aligned) @ 11:00 | 25 | **CONFIRMED edge** — see below. |
| E6 | Thesis-first `thesis_rank_reject` outcome A/B, whole-market BREAKOUT/BREAKDOWN | 10 (n=599) | **⚠ REJECT graded BETTER than PASS** (64.3% vs 52.3% WR) — see below. |

### E2 — entry timing (25 sessions, opening-drive, held-to-close)
```
11:00  +1.5% EV / 36% win     10:00  −7.8%     10:30  −9.1%     9:45  −12.1% / 26% win
```
Later > open by ~13 EV pts, monotonic — **real but modest.** The live gate unlocks entries at **9:45**
(`gates.ts`, user-directed 2026-07-13) — the *worst* tested time — and `timeOfDayFactor`
(`intraday.ts:164`) **rewards 9:50–11:00 (+5)** while **penalizing 11:00 (−5 "lunch chop")**, the best
cell. Boundaries look mis-set. *Do not rewrite unilaterally:* my grader holds to close (no exit
engine), and there is a standing user directive on the 9:45 unlock — surface evidence, validate on the
live by-ToD ledger (`record.ts by_time_of_day`).

### E3 — confluence (the edge)
```
−50/+100:  0-conf −12.5% EV | 1-conf 0.0% | 2-conf +15.9% EV (41% win)   [n = 4 / 49 / 22]
−30/+50 :  0-conf −10.0%    | 1-conf +3.5% | 2-conf −1.8%
```
- **Monotonic EV ladder with confirmations.** Confluence works.
- **Resolves the geometry paradox:** −50/+100 is "worst over all trades" (bleeds on noise) but **BEST
  for the confluent subset**; tight −30/+50 *destroys* it. Confluence selects trend-*continuation*
  trades that need room to run. The live −50/+100 is right — **only for high-conviction setups.**
- **Maps onto existing machinery:** G-1 tape-alignment ≈ SPY confirmation, intraday VWAP read ≈ VWAP
  confirmation, `timeOfDayFactor` ≈ timing. The system scores these **additively** today; the win is
  to require their **CONFLUENCE** as a premium tier.

### 0DTE decision
Take fewer, **triple-confirmed** trades (post-open timing + VWAP-side + market-aligned), +1 OTM, on the
**let-it-run −50/+100** geometry → ~40% win / +16% EV. Gate the rest out. Ship the confluence tier
**calibration-first**; let the ledger confirm before it gates.

### E4 — the WIN-RATE ceiling, and the mirror engine (iron condor)
"Make it 70–80% WR" is **unreachable by tuning directional buying.** A stop/target sweep on the confluent
subset shows a tighter profit target buys win rate but *destroys* EV: even a +25% scalp caps at ~65% WR
and goes negative (the −50/+100 let-it-run at ~40% WR is the EV peak). Win rate on a **long** 0DTE option
is bounded by needing a directional move — you can't buy your way to 75%.

The 70–80% WR lives on the **other side of the trade: SELLING** a 0DTE iron condor. Same infra, opposite
skew. Backtest (`npm run wr:condor`, SPY/QQQ/IWM × 25 sessions, 11:00 entry, close settle) — WIN = close
lands inside both short strikes:
```
short width   ±0.40%  ±0.60%  ±0.80%  ±1.00%  ±1.50%
WIN%            60      77      92      96     100      (n=75)
```
The shipped `selectIronCondor(target=80)` geometry graded over the same tape → **98.7% WR** (it rounds
short strikes *away* from spot, so realized width ≥ nominal), with an **18.7% intraday-breach** rate
(price *touched* a short then recovered by close). That breach number is the honest catch: **high WR is
NEGATIVE skew** — a small credit ~80–99% of days, a bigger (but **DEFINED**, capped by the long wings)
loss on the ~1–20% breakout days. WR is real; **profitability is not implied by WR** — it needs the credit
priced right off the live chain + a breach stop + small size. Condors win on range days, directional wins
on trend days → the two engines are **naturally hedged**.

**Iron-condor decision:** ship the strike-selection core (`src/lib/zerodte/iron-condor.ts`, pure geometry:
width-for-target-WR pushed **beyond the dealer GEX walls**, defined-risk wings) + the reproducible WR
backtest (`condor-wr.mjs`) **calibration-first — evidence only, not gating.** The graded ledger (real
credits, real breach-stop fills) graduates it into a live second play-type before it sizes real risk;
until then it's a measured geometry + an honest skew warning, not an EV claim.

### E5 — the exit engine is the spine (P3, resolved): hold-and-scale beats the ratchet
The exit-engine study (P3) closed the loop on "80% of the plays should be GREEN." Two mark-faithful
findings, both reproducible in `zerodte-sim.mjs`:

1. **Green IS available on almost every directional play — the exit, not the entry, decides red/green.**
   An MFE (max-favorable-excursion) pass over the graded index plays: **97.7%** offer a sellable green
   exit at some point in the session (a 10–1000% window), only **2.3% never print green**. So the user's
   instinct ("if the board prints it, we should be able to sell it in profit, never red") is *reachable*
   — but only by an exit that *takes* the green, not one that round-trips or scratches it.

2. **The shipped index ratchet costs EV vs hold — CONFIRMED, live change DEFERRED.** The sim grades through
   the SHIPPED exit (`gradeThroughExitEngine`), now **mark-faithful** (a 10-agent adversarial audit caught
   the grader booking ratchet exits at the best-case floor, not the gap-through fill; grading post-15:30;
   and an entry-bar look-ahead — all fixed, FINDINGS 2026-07-23). Re-swept honest over a dense Feb→Jul grid
   — **276 plays / 40 sessions** (all) and **106 index-only** — HOLD (−50/+100) beats the shipped ratchet
   on the full sample by **+4.1 pts/play** (all) / **+2.8** (index-only). Mechanism: `ratchet_arm_pnl_pct=25`
   arms a breakeven floor exactly when a 0DTE momentum play is *continuing*, scratching the runners. The
   ratchet **buys win-rate (34%→51%), not EV** — a textbook green≠profitable result. The **direction**
   (hold ≥ ratchet) is robust; the **optimal intermediate config** is NOT identifiable even at n=276 — the
   calib window ranks HOLD best, the newest-30% ranks the ratchet best (they disagree; 0DTE EV is a
   few-big-winners distribution). So the finding is logged and the fix stays scoped to a regime-conditioned
   sweep or a live-ledger `recommendExit` verdict — we do **not** flip a live risk-management exit on OOS
   windows that disagree. **Update:** testing the *mechanism* (partial TRIM-at-arm vs the floor-EXIT) DOES
   separate — `trim ⅓@+25 + ⅓@+50, run` beats both HOLD and the shipped floor-exit in every split + both
   universes over 352 plays (win-rate 32%→50%); it's the leading replacement, to graduate via the live
   counterfactual ledger per `exit-engine.ts`'s own "tune with data" design (FINDINGS 2026-07-23).

**Follow-up scoped but BLOCKED (2026-08-28): does C-tier/untiered specifically benefit from
trim-scale, or was "C stays ratchet" ever actually measured?** The E5 graduation (FINDINGS
2026-08-xx, `resolveExitModeForTier`) shipped A/B on `trim_scale` and C on `ratchet` — but the 276/352
-play E5 sweep above never split by tier at all, real or cosmetic (`convictionOf()` in
`zerodte-sim.mjs` is explicitly labeled cosmetic; the real `assignZeroDteTier` was never invoked on
the sim's plays). So "C-tier's signal quality doesn't justify the looser runway" (the comment in
`exit-sync.ts`) is a plausible prior, not a measured result — exactly the gap Task tracking flagged as
needing "a real E5-style backtest" before it's touched.

Investigated building it and found **two real blockers, not just scope**:
1. **No reachable data source carries real historical contract fields.** `GET
   /api/market/zerodte/record` (the public API every other A/B script here reads) exposes grades
   (`plan_outcome`/`managed_outcome`/`pnl_pct`) and `entry_context`, but NOT `entry_premium`,
   `top_strike`, or `expiry` — those are separate DB columns (`scan.ts` writes them outside
   `entry_context`) with no admin export route surfacing them per-play. Without entry premium/strike/
   expiry, a real historical row can't be re-priced against the OCC option's own minute bars, so
   `gradeThroughExitEngine` (the mark-faithful grader `zerodte-sim.mjs` already carries for exactly
   this A/B) has nothing to replay.
2. **`zerodte-sim.mjs`'s own simulated candidates can't be tiered correctly either.** `assignZeroDteTier`
   needs `cortexScore`/`cortexVetoCount`/`cortexAbsentCount`/`vixOpen` — the sim runs real flow
   accumulation and real chain/bar fetches but never runs Cortex or fetches VIX for its candidates, so
   feeding its plays through the real tier function would cap most of them at B/C purely from missing-
   evidence rules (`vixOpen == null` alone caps the ceiling at B) — a confound, not a genuine C-tier
   sample. Forcing it through anyway would risk shipping a WRONG verdict on a real risk-management gate,
   which is worse than leaving the question open.

**What would unlock it:** either (a) an admin-scope `/record`-style export that includes
`entry_premium`/`top_strike`/`expiry` per play (reusing the same auth pattern as the existing scripts,
scoped read-only), letting the C-tier population be pulled from REAL committed rows and re-graded on
real option bars — the higher-fidelity path since it uses real historical tier assignments
(`tierFromEntryContext`, already computed correctly server-side); or (b) wiring a real VIX-open fetch +
Cortex evaluation into `zerodte-sim.mjs`'s candidate loop so its own generated plays can be tiered
correctly before grading. (a) is the smaller change and reuses more of what already exists. No gate
touched; C-tier stays on `ratchet` pending real evidence either way.

**Update 2026-08-29 — blocker (1) resolved, blocker (2) still open.** Shipped option (a):
`GET /api/admin/zerodte/tier-export` (PR #3112) exposes `entry_premium`/`top_strike`/`expiry`/real
`tier` per historical play — those fields were never actually missing from the DB
(`fetchZeroDteSetupLogRange` already returns them), only from every HTTP response, since `record.ts`
aggregates them away. **The backtest script itself — pulling this export, fetching each real
contract's OCC minute bars, and re-grading C-tier/untiered rows through `gradeThroughExitEngine`
under `ratchet` vs `trim_scale` — is still not built.** That remains the next concrete step before
this item can close; `resolveExitModeForTier`'s C-tier→ratchet policy is unchanged.

**Update 2026-08-29 (later) — MEASURED, item closed.** Built `scripts/audit/tier-exit-mode-ab.mjs`
(`npm run ab:tier-exit-mode`) per the plan above. First live run, 90-day window: 111 real C-tier/
untiered plays, 99 graded through both modes on real minute bars via the same shipped
`evaluateExitState`/`TRIM_SCALE_RULES`. **RATCHET wins**: 45.5% win-rate / +5.5% avg P&L vs
trim_scale's 38.4% / −7.3% — a −12.8pp avg-P&L, −7.1pp win-rate delta AGAINST trim_scale for this
population, the opposite of the A/B-tier E5 result above. Likely driver: ratchet let 43/99 rows
run to `runner_close` vs only 18/99 under trim_scale, and trim_scale's earlier ⅓-banking didn't
make up the difference even with 29 `doubled` hits. See
`docs/audit/findings-staging/2026-08-29-c-tier-exit-mode-ab-measured.md` for the full breakdown.
**No gate changed** — `resolveExitModeForTier`'s C-tier/untiered→ratchet default is now empirically
supported rather than merely inherited, and a single 90-day sample argues to LEAVE IT, not flip it.

**Follow-up (2026-09-04): the regime-conditioned trend dead-zone — MEASURED, INSUFFICIENT DATA, no
gate changed.** `decideTrimScale`'s own dead-zone-guard comment (`exit-engine.ts`, ~line 300) names a
residual gap its 2026-08-27 fix (`trimAvailable = armed > taken`) does not close: the shared
`ratchetFloorPct` breakeven arm is a FIXED peak +20% while `TRIM_SCALE_RULES.tranches_by_regime` is
regime-conditioned (neutral +20, range +15, trend +40). For neutral/range the two tables coincide or
cross before +20%, so the 2026-08-27 guard suppresses the floor-dump whenever a tranche is armed or
about to arm. `trend` cannot benefit — its first tranche is +40%, so a peak in **[20%, 40%)** arms the
shared breakeven floor while `trimTranchesArmed` is still 0, and the floor dumps the WHOLE position to
~0%. A same-session sweep of `GET /api/market/zerodte/record?days=90` found exactly this signature
live: 37/372 graded 0DTE plays (9.9%) exited via `ratchet_breakeven_floor` after a median +26.67% peak
(up to +48.56%), two concrete examples 2026-09-03 (`BULL` +20.45%→0%, `CLS` +31.18%→0%).

Built `scripts/audit/regime-dead-zone-ab.mjs` (`npm run ab:regime-dead-zone`), same harness pattern as
`tier-exit-mode-ab.mjs`: real `GET /api/admin/zerodte/tier-export` rows (session_regime + entry
premium/strike/expiry), real Polygon minute bars, re-graded through the SAME shipped
`evaluateExitState`/`TRIM_SCALE_RULES` for CURRENT and FIX A (mutates
`tranches_by_regime.trend[0]` down to +20% in-process, restored after — a real engine run, just a
different threshold); FIX B (replace the hard 0% breakeven floor with a partial `peak * 0.5` floor
specifically inside the dead zone) needed a decision-logic change `decideTrimScale` does not expose, so
it is a clearly-labeled script-local re-implementation (bar-replay harness copied, decision logic
re-derived from the shipped thresholds/comments — same REAL-vs-RE-IMPLEMENTED honesty split
`tier-exit-mode-ab.mjs` already documents).

**First live run, 90-day window: INSUFFICIENT DATA, and for a specific, checkable reason.** Only 19 of
372 rows in the export even carry a `session_regime` at all (`entry-context.ts`'s stamping is real but
recent), and of those only **3 are `trend`** — the regime the dead zone actually lives in (`range`: 12,
`neutral`: 4). Of the 15 rows that fetched real bars and graded, **zero** landed in trend's own [20%,
40%) dead-zone-with-zero-tranches-armed window. This is not a null result about the bug — the bug's own
live evidence (37 breakeven-floor dumps above) is unambiguous — it is a null result about whether
*trend-regime, trim_scale-eligible* plays are common enough yet to backtest the fix's own tradeoffs
(FIX A trims earlier and gives up trend-day runway; FIX B still gives back half the peak). `exit-sync.ts`
confirms why: `ZERODTE_TRIM_BANK_LIVE`/regime-conditioning only flipped ON by default 2026-09-03, one day
before this run — the population needed to measure this fix has barely started accumulating.

**No gate changed.** `TRIM_SCALE_RULES.tranches_by_regime.trend` and `decideTrimScale`'s floor
computation are untouched; a change here is real risk-management surgery (same caution the TRIM-badge
item above already establishes for this exact file) and per this repo's own evidence bar deserves more
than 0-3 real trend samples. **Re-run `npm run ab:regime-dead-zone -- --days=90` in 2-3 weeks** once
`session_regime`-stamped trend rows have accumulated — the script is built, live-auth-tested, and ready;
it just needs a population that doesn't exist yet.

### E6 — thesis-first `thesis_rank_reject` outcome A/B (whole-market BREAKOUT/BREAKDOWN, 2026-09-10)

`ZERODTE_THESIS_FIRST` is live. On 2026-09-09 its `thesis_rank_reject` gate (the archetype/rank
quality floor `resolveThesisRankTier` fires when `evaluateArchetypeGates` returns `BLOCK`,
`thesis/live-pipeline.ts`) alone accounted for 218/1,705 gate-blocked events that session — more
than any single hard-gate code — yet `zerodte-gate-compound-funnel.mjs` explicitly scoped to
FLOW-origin setups and listed "BREAKOUT/PIN origins" under its own NOT MEASURED THIS RUN. Nobody
had asked the outcome question: does REJECTing these solo-BREAKOUT/PIN setups actually improve
forward results?

Built `scripts/audit/thesis-rank-reject-outcome-ab.mjs` (`npm run ab:thesis-rank-reject`): real
`screenBreakoutMovers`/`screenBreakdownMovers` (the real whole-market screen) → real dynamic
cap/momentum-rank (`resolveBreakoutCandidateCap`/`rankMoversForChainFetch`) → real per-ticker
intraday read (`computeIntradayRead`, real Polygon minute bars) → the REAL, unmodified
`attachThesisFirstLive` (the exact function scan.ts calls live, real rail scoring/archetype
classification/gates/rank-tier resolver) → favorable-first forward grade on real Polygon minute
bars from a fixed ET entry checkpoint (same proxy convention as `discovery-recall-probe.mjs`).
Setup construction omits `key_resistances`/`key_supports`/`rel_volume` (disclosed in the script
header, and verified NOT a shortcut: `buildBreakoutSetup`/`enrichSetup` leave these null/empty
for BREAKOUT-origin setups in production too, since no technicals dossier is passed for that
origin — this tool matches production exactly on these fields, not a weaker approximation of it).

**First live run, 10 sessions (2026-08-26…2026-09-09), entry=10:30 ET: 599 graded — REJECT n=129
(64.3% win rate, avg maxRet +1.3%) vs PASS (control, non-REJECT) n=470 (52.3% WR, +1.2%).**
**⚠ The gate REJECTED setups that graded BETTER than the ones it let through**, the opposite of
what a quality floor should do. Breakdown: 115/129 REJECTs fire on `momentum_abs_floor`
(archetype `MOMENTUM_CONTINUATION`, `rail_scores.MOMENTUM < 60`) — only 14/129 on
`breakout_score_floor`. **Sensitivity check at entry=10:00 ET (same 10 sessions): REJECT 72.9%
WR (n=133) vs PASS 52.4% (n=466)** — same direction, larger gap; not an artifact of the specific
entry-time choice. This systematizes, at n=129/599 across 10 sessions, the exact concern
`archetype-gates.ts`'s own code comment already flagged from a single live anecdote (2026-08-28,
INTC 92P REJECTed on `momentum_abs_floor`, later ran +275%) — the anecdote generalizes.

**Read carefully before acting on this:** the dominant rejection reason (`momentum_abs_floor`)
is really testing "did this BREAKOUT-origin name ALSO clear a `MOMENTUM` rail floor of 60"
(`scoreMomentumRail`: base 40 + up to 12 for 5m-trend-aligned + up to 10 for VWAP-aligned, capped
at 62 without `rel_vol`/`change_pct` — neither ever populated for a BREAKOUT-origin setup in
production) — i.e. it demotes/rejects a clean BREAKOUT/BREAKDOWN print for lacking a SEPARATE,
narrow momentum confirmation, not for being a weak breakout. That reads as a real candidate for
recalibration (the floor, or requiring a second rail at all for this archetype), but this A/B is
evidence, not a verdict on ONE session's worth of extra confirmation — **no gate changed here.**

Extended `zerodte-gate-compound-funnel.mjs` with a new "BREAKOUT/PIN THESIS-RANK-REJECT" section
(clearly labeled a DIFFERENT pipeline from its own hard-gate stack): a live, single-snapshot
isolated `thesis_rank_reject` rate for today's BREAKOUT/BREAKDOWN screen, plus a live
`discoverPinSetups` attempt. **PIN has no reachable measurement path from this sandbox at all**
— two independent blockers, either alone sufficient: `discoverPinSetups` needs a live GEX-heatmap
snapshot (server-side UW product, cache-only, no historical replay, same limitation
`wall-temporal-stability.mjs` already documents), AND importing `pin-discovery.ts` from a plain
Node script throws `"This module cannot be imported from a Client Component module"` — a Next.js
client/server module-boundary marker in `resolveTickerChainRows`'s dependency graph. Reported as
INSUFFICIENT DATA, not fabricated; a PIN measurement needs to run where that module's full server
graph already loads (inside the app, admin-gated) or a poller built the way
`gex-wall-snapshot-poll.mjs` is (authenticate through the live app's own API route).

---

### Board status badge: the TRIM threshold bug is real, and the earlier deferral was correct (2026-08-28)

**The bug** (Task tracking #60/#62): `derivePlayStatus` (`plan.ts:735`) flips a committed row's live
lifecycle badge to `"TRIM"` only when `peak >= entryPremium * 2` — the shipped RATCHET's fixed +100%
target — with no awareness that A/B-tier rows run under `exit_policy_at_commit === "trim_scale"`, whose
real first-tranche threshold (`TRIM_SCALE_RULES.tranches_by_regime.neutral[0]`, currently +20%) is far
below that. So a trim_scale row that has already banked a real tranche at +20-25% still shows
`"OPEN"`/`"HOLD"` — not just a display bug, since `derivePlayStatus`'s output is PERSISTED to
`zerodte_setup_log.status` via `advancePlayLatch` (marks-math.ts) and `syncLedgerLiveState` (scan.ts).

**Ran a 34-agent consumer audit** (28-file discovery pipeline + a 5-pronged adversarial verify pass,
`Workflow` tool) before touching anything, given the earlier deferral's stated reason ("real regression
risk to a shared live state machine"). Verdict: **that caution was correct, and now precisely scoped.**

Almost every consumer of persisted `status` (governor.ts's concurrency/premium/short-gamma/concentration
checks, thesis-health.ts's compute-gate, scan.ts's live-quote/exit-eval row filters, the board API) only
ever branches CLOSED-vs-not-CLOSED, or lumps OPEN+HOLD+TRIM into one undifferentiated "still live"
bucket — genuinely unaffected by moving the TRIM threshold. But TWO real, TRIM-specific functional
dependencies exist, both verified by direct read (not just the audit's claim):

- `exit-sync.ts:349` — `trimmed: opts.status === "TRIM"`, feeding `evaluateExitState` → `ratchetFloorPct`.
- `zerodte-service.ts:434` — `ratchetFloorPct(pinnedLivePnlPct(...), r.status === "TRIM")`, the served
  `floor_pnl_pct` board field.

Both call `ratchetFloorPct(peakPnlPct, trimmed)` (`exit-engine.ts:184`), which — when `trimmed` is true —
forces the protective floor straight to `EXIT_RULES.runner_floor_pct` (+50%), **regardless of the actual
peak**, on the assumption TRIM only ever fires at the ratchet's +100% target (where a +50% forced floor
is exactly half the peak — sensible). Lowering the TRIM threshold to trim_scale's +20% for A/B-tier rows
breaks that assumption: **a row peaking at +22% would get its floor forced to +50%, a level it never
reached** — which can (a) trigger an immediate/incorrect stop-out in the live exit engine, or (b) serve
members a `floor_pnl_pct` figure above the play's actual peak. Both are real financial-risk regressions,
not a relabeled badge.

One TRIM-specific consumer would actually IMPROVE with the fix (`intel.ts:142`'s Largo-facing narrative
picks the right "already trimmed, house money now" line sooner) and one is display-only and safe
(`ZeroDteBoard.tsx`'s trim-ladder banner). Neither blocks anything.

**Verdict: the minimal 3-call-site `derivePlayStatus` fix alone is UNSAFE to ship — necessary but not
sufficient.** A safe version needs to ALSO decouple the forced-runner-floor behavior at those two exact
call sites from the raw `status === "TRIM"` literal — e.g. gate it on
`exit_policy_at_commit !== "trim_scale"` (ratchet rows keep today's behavior byte-identical) or introduce
a separate "ratchet-target-trim-occurred" signal distinct from the display status — before the TRIM
threshold itself can move. Not attempted in this pass; this is now a precisely scoped two-part fix
(threshold change + floor-forcing decoupling) rather than an open question, and it's real exit-engine
surgery on a live risk-management path, so it should get a dedicated pass with its own test coverage of
the exact regression scenario (a trim_scale A/B-tier row peaking between +20% and +100%), not be rushed
in alongside something else.

**The banger scale-out is the flagship, and it's the positive-skew spine both engines share.** Validated
at scale (minute-bar realistic gap-fills, **7,086 movers / 500 sessions / 2 years / all sectors**):
**+26% gross / ~+20% net-OOS** realized under the mechanical scale-out (0.5@2×, trail runner at 50% of
peak, hard stop 0.4×) — vs hold-to-expiry ~1.0× (decays to zero). Re-confirmed at ~1000-play scale
(**1176 movers, +19% net-OOS, 53% green**, realistic minute fills + 7.5% slippage); the shipped trail 0.5
sits at/below the OOS optimum. That is the durable edge: buy cheap positive-skew optionality, then *exit
mechanically into the spike*.

**LIVE-WIRED (step 6b — COMPLETE):** the flagship is no longer backtest-only. The overnight outcomes cron
now grades every banger on its OPTION's forward bars and pins the grade on `nighthawk_play_outcomes.scale_out_grade`
(a bridge, since bangers live in the nighthawk ledger, not `zerodte_setup_log`): pure resolver + mapper
(#973) → migration + fail-soft cron pin (#974) → nighthawk-side `recommendScaleOut` reader + read-only
track record on the admin analytics route (#975). The graduation rule (`recommendScaleOutFromGrades`: EV
delta ≥ 0.15/$1, n ≥ 10, ungradeable never imputed) is shared with the 0DTE ledger so it can never drift.
The full path is proven live (real daily option bars → real multiple). The last step (6d — flipping the
live managed exit) fires automatically once the live ledger reads `enforce`; until then the scale-out
stays advisory and accrues evidence.

**Rearchitecture synthesis (task #21):** the "strongest 0DTE engine" is not one clever entry — it's a
**two-engine, positive-skew, scale-out-spined** system with a **calibration-first graduation ladder**:
- **Engine A (index 0DTE grinder):** SPY/QQQ/IWM/SPX — the only true same-day-expiry names. Confluence
  tier (E3, +16% EV) takes fewer triple-confirmed trades; let-it-run geometry; the ratchet finding above
  is the next exit tune.
- **Engine B (whole-market weekly banger):** all sectors, cheap OTM weeklies, the +20% net-OOS
  scale-out. Finding movers is trivial; the exit is the whole edge. **Now live-wired end-to-end (6b):**
  graded on the option basis every night, pinned to the ledger, read by the graduation verdict.
- **Spine:** every new signal/exit ships as **evidence pinned in `entry_context`** (non-gating); the
  graded ledger graduates it via `recommendGate`/`recommendSignal`/`recommendScaleOut` (ENFORCE_MIN_BLOCK_N,
  ENFORCE_MIN_DELTA) before it sizes or gates real risk. The measurement loop — not any single parameter —
  is the moat.

### E6 — does `score_floor` (65) actually rank forward outcome? An independent re-check (2026-09-10)

**The open question.** `zerodte-gate-compound-funnel.mjs` measured twice (2026-09-08 off-hours n=15,
2026-09-09 RTH n=26) that `score_floor` (G-3, `ZERODTE_SCORE_FLOOR = 65`) is the dominant ISOLATED-
rejection gate on FLOW-origin whole-market 0DTE setups — 84.6% isolated failure at RTH, the clear
chokepoint on play COUNT the operator has repeatedly complained about live — and left open whether 65
itself is miscalibrated or the score formula genuinely underscores tradeable setups. "Needs a backtest
of the score distribution against forward outcomes before touching the threshold," per that script's
own header.

**Why 65 was set in the first place (F-2, `NIGHTHAWK-0DTE-DECISION.md`, 2026-07-13, n=16, real option
premium graded):** the engine's own 14-day calibration at the time found the 55–64 score band ran
**18.8% WR / avg −24.5% premium** — below the 33.3% breakeven line on the −50%/+100% payoff — while
65–74 ran 50% WR/+21.1% and 75+ ran 50% WR/+9.9%. That is the evidence the 65 floor exists on. It is
also ~2 months old, n=16 in the load-bearing band, and measured against the THEN-current engine, not
today's `deriveZeroDteSetups`/`gates.ts`.

**This re-check (`zerodte-score-floor-outcome-backtest.mjs`).** Re-derives the REAL FLOW-origin score
for 18 real historical trading days (2026-08-13…2026-09-08, chosen as the most recent complete sessions
UW's flow-alerts `older_than` pagination reaches from this sandbox — confirmed live back to at least
2026-08-14 with zero errors) directly from UW flow-alerts (same re-fetch precedent as
`zerodte-gate-compound-funnel.mjs`: same alerts, different pipe from the Postgres table production
reads from), runs the REAL `deriveZeroDteSetups` (board.ts) per day with that day's own 3-day
accumulation window and as-of clock (so `dte`/expiry filtering is correct for each historical day, not
just "now"), and grades every scored setup's forward move on REAL Polygon minute bars with the
favorable-first underlying-continuation proxy `discovery-recall-probe.mjs`/`merge-precedence-ab.mjs`
already use (fixed 10:00 ET entry, +1.5%/−0.75% favorable/adverse) — **NOT real option premium like
F-2 used**, a materially different and coarser grading rule, stated here so the two measurements are
never conflated as directly comparable. Bucketed into bands fixed BEFORE looking at any result,
straddling 65 exactly (`lib/score-floor-backtest-eval.mjs`).

**Result — 18 sessions, 393 setups sampled, 392 graded:**
```
score band              n     win%     avg maxRet%
0-39                    47    19.1%     0.75%
40-54                  206    20.4%     0.72%
55-64 (blocked today)   78    25.6%     0.76%
65-74 (clears today)    55    14.5%     0.57%
75-84                    6    33.3%     0.91%   (excluded, n<30)
85-100                   0     —         —
```
**The headline comparison this re-check exists to answer — does the population score_floor lets
through beat the population it blocks?** **NO, not in this sample:** 55–64 (blocked) graded **25.6%**
vs 65–74 (clears) at **14.5%** — a **−11.1pp delta AGAINST the floor's implied ordering**, the opposite
direction from F-2's 55–64-underperforms finding.

**Verdict (same discipline `helix-score-signal.mjs` uses — requires a real spread AND a monotonic
Spearman trend, never a spread alone): `SPREAD WITHOUT ORDER`** — spread 11.1pp, rank correlation
ρ = −0.20 (short of the ±0.6 threshold for RANKS/INVERTED). The bands differ but do not trend with
score; the two directly-comparable bands (n=78, n=55, both ≥30) sit in the "wrong" order and the two
lower bands (0-39, 40-54) both under-perform 55-64 too. This is the same verdict shape HELIX's own
conviction-score probe reached for an analogous question — a second, independent instance of a
BlackOut scoring formula whose ordering does not survive an outcome check, worth noting for anyone
building a NEW score elsewhere in the product.

**Does this REFUTE F-2 or justify removing the floor? No — read the scope before acting on this.**
This measures a favorable-first UNDERLYING-continuation proxy at a FIXED synthetic 10:00 ET entry, not
real option P&L (no strike, no premium decay, no exit-management rule) — a different, coarser
instrument than F-2's real-premium grading. It also measures `score` ALONE, never jointly with the
other ~14 hard gates (VIX regime, confluence, governor, Cortex — see `zerodte-gate-compound-funnel.mjs`
for those). A setup graded here as a "65-74 win" may still be blocked live by a different gate, and a
"55-64 win" here was never exposed to real slippage/spread on the actual option leg. What this DOES
say: on the specific, narrower question of whether `score` alone ranks a coarse forward-continuation
proxy, the evidence over a real, well-powered (n=392) recent sample does not support a clean ordering
around 65 — which means the standing question ("miscalibrated floor, or genuinely weak setups below
it?") is still open, not closed in either direction, and deserves a real-option-P&L re-run of F-2's
own methodology at today's larger achievable sample size before anyone touches the threshold.

**No gate changed.** Evidence-gathering only, same discipline as every other calibration A/B in this
toolkit (`cortex-oppose-magnitude-ab.mjs`, `tier-exit-mode-ab.mjs`, etc.) — this reports a verdict and
leaves the decision to a human reading it.

---

## Part 2 — Whole-market weekly BANGER engine

### The whole market is scannable, and it's full of bangers
Polygon grouped-daily (`/v2/aggs/grouped/locale/us/market/stocks/{date}`) returns **every** US stock
(~12,400/day). A dumb breakout+volume screen (gain ≥5%, vol ≥1M, closed strong, $5–400) → cheap ~5%
OTM weekly call, held ≤9 days:

```
BANGER BACKTEST — 5 sessions, top-15 $-vol movers/day, cheap OTM weekly call
ALL movers            n=28   ≥2x 75%   ≥3x 50%   ≥5x 25%   medMax 3.1x   avgHold 1.04x
vol ≥ 20M (heavy)     n=11   ≥2x 91%   ≥3x 55%   ≥5x 18%   medMax 3.1x   avgHold 0.11x
gain≥10% AND vol≥20M  n=2    ≥2x 100%  ≥3x 100%  ≥5x 50%   medMax 5.7x   avgHold 0.13x
Top: ANET $0.36→23.3x · PANW 8.4x · CNMD 7.0x · SSPC 6.4x · JOBY 5.8x · QTTB 5.7x
```

### The decisive caveat — and the real edge (VALIDATED)
`maxRet` is the **sell-at-the-top upper bound**. Hold-to-expiry is **~1.0–1.3x** (mediocre, inflated by
the odd ANET) — **held to expiry these bangers decay to near-zero.** They spike then bleed. The edge is
a **mechanical scale-out** (sell 50% at 2×, trail the runner at 50% of its peak, hard stop −60%). Under
that rule, realized EV across the sessions with data:
```
REALIZED EV per $1 risked (scale-out):  2026-06-22 +47% (n=6) · 2026-07-06 +86% (n=12) · 2026-07-13 +16% (n=10)
=> ~+50% weighted mean across n=28, EVERY session positive.  (maxRet mean ~5.6x, hold-to-expiry ~1.3x.)
```
**Caveats (honest):** 2 of 5 tested sessions had no gradeable setups (weekly-option data coverage / no
qualifying movers) — a real coverage gap; n=28 is modest; daily-bar exit granularity; no bid-ask
slippage; entry at mover-day close. But the direction is unambiguous and large: **the scale-out exit
turns fleeting whole-market bangers into strongly +EV trades; holding to expiry does not.** Reproduce:
`npm run scan:bangers -- --grade=YYYY-MM-DD`.

**Therefore:**
1. **Finding bangers is trivial** (a pure screen surfaces 2–5x+ constantly). Not the edge.
2. **Exiting is the entire game.** A mechanical **scale-out into the spike** (partial at 2x, trail the
   runner, hard stop) converts the 75%-touch-2x population into strong realized EV; holding round-trips
   it to zero. **This is where a system beats a human.**
3. **Confluence shows again** (heavy-vol movers hit ≥2x 91% vs 75%). Stacking flow + catalyst tightens it.
4. **Sizing = lottery math:** many small asymmetric bets; the exit discipline is what makes the
   distribution +EV.

### Whole-market banger architecture (buildable from existing pieces)
- **Discovery (daily, whole market):** grouped-daily screen — momentum/gap breakout, close-strength,
  rvol surge, price/liquidity filter → candidate movers. (Existing dossier tech: `breakout_zones`,
  `support/resistance_levels`, `prior_day`, `rel_volume`, `atr14`.)
- **Confluence overlay:** UW whale accumulation (the merged accumulation engine, #943/#945) + Benzinga
  catalysts (`fetchMarketCatalysts`: fda/guidance/m&a/earnings) + market/regime alignment. Require ≥2–3
  pillars for a "banger" tier.
- **Play:** cheap OTM weekly (asymmetric, ~$0.30–2.00).
- **Exit engine (THE edge):** scale-out at 2x, trail the runner, hard stop, no hold-to-expiry. Mirrors
  the 0DTE `exit-engine.ts` ratchet — extend it for the banger horizon.
- **Risk:** small per-bet, portfolio of many, regime-gated.

---

## Synthesis — what makes it "legit top-tier"
1. **No single lever wins.** Discovery window, strike, stop/target ratio each hover near breakeven alone.
2. **Edge = confluence × timing × exits × regime.** Fewer, higher-agreement trades; enter after the
   open resolves; **manage exits mechanically**; size/gate by regime.
3. **The live architecture is largely RIGHT** (multi-signal scorer + gates + exit engine + governor +
   calibration graduation). Wins are in **tuning on evidence**, plus concrete fixes: the 9:45 unlock,
   the `timeOfDayFactor` boundaries, and requiring confluence vs additive scoring.
4. **Exits are the edge** (E5 resolved it) — for 0DTE the grader now replays the SHIPPED ratchet and
   proves hold > ratchet (fix deferred, FINDINGS 2026-07-23); for bangers the mechanical scale-out is the
   +20% net-OOS spine that converts the maxRet→hold collapse into realized EV.
5. **The measurement loop is the moat.** The simulator + the ledger's calibration buckets let every
   change be proven before it gates. That is what makes it top-tier vs vibes.

## Prioritized plan (evidence-ordered)
- **P1 — Confluence tier (0DTE)** — CONFIRMED +15.9% EV. `confluence_score` across {timing, VWAP,
  market-align}; A+/"triple-confirmed" tier on let-it-run geometry. Calibration-first.
- **P2 — Whole-market banger scanner** — committed tool first (grouped screen + confluence), then wire
  into discovery. THE "scan the whole market for bangers" ask.
- **P3 — Exit-engine study** — ✅ RESOLVED (E5). Sim now grades through the SHIPPED ratchet
  (`gradeThroughExitEngine`); banger scale-out validated +20% net-OOS at 500-session scale; shipped index
  ratchet CONFIRMED to cost EV vs hold (fix deferred to a larger sweep, FINDINGS 2026-07-23).
- **P4 — Regime conditioning** — validate F-1 (VIX 15–17 → 69% WR) on 25+ sessions; gate/size by VIX.
- **P5 — Entry-timing correction** — re-measure `timeOfDayFactor` + 9:45 unlock on the live by-ToD
  ledger; propose a measured shift (surface the 2026-07-13 directive to the user).
- **P6 — Learning machinery (PR-A)** — persist accumulation + calibration buckets so P1–P5 graduate on
  live evidence automatically.
- **P7 — Event-driven scan + unify Night Hawk scorer** — infra + architecture.

## BREAKOUT `gain_over_range` ranking — real committed option-P&L validation, SCOPED BUT BLOCKED (2026-09-10)

The 2026-08-07 finding (`FINDINGS.md`) measured `gain_over_range` beating the shipped `momentum`
BREAKOUT ranking on an underlying-continuation proxy and explicitly recommended, before shipping:
*"Re-rank with gain_over_range behind a flag and A/B it on real committed 0DTE plays over >=20
sessions, measuring realised option P&L rather than the underlying proxy."* What shipped (PR
#2846, merged 2026-08-25) was a direct unconditional swap — no flag, no A/B. It's now been live
15+ trading days, so the originally-recommended validation should finally be runnable against real
data — that was this task.

**Tool built and smoke-tested against real data:** `scripts/audit/breakout-gain-over-range-option-
pnl-ab.mjs`. Part A pulls every real committed BREAKOUT-origin play since 2026-08-25 via
`GET /api/admin/zerodte/tier-export` and reports its already-graded REAL option P&L (official
WS-10/WS-11 executable grade preferred over the mid grade, same precedent as
`outcome-grading-audit.mjs`) — no reconstruction needed, production already grades every committed
play against the option's own historical minute bars. Part B re-screens each play's real historical
session date with the REAL `screenBreakoutMovers`/`screenBreakdownMovers` + the REAL dynamic cap
(`resolveBreakoutCandidateCap`), then runs the shared, already-tested `splitBreakoutCohorts` helper
twice over the identical pool — once with the REAL shipped `rankMoversForChainFetch` (gain_over_
range) and once with a re-implemented `momentumRank` (the ranking it replaced, reproduced from the
original finding's own recorded formula since it no longer exists in `src/`) — to partition real
committed plays into MOMENTUM_ALSO (the old ranking would have prioritized this ticker too — the
swap isn't why it's on the board) vs GAIN_OVER_RANGE_EXCLUSIVE (exists only because of the swap;
its real P&L is the swap's own doing). Full methodology/scope caveats are in the script's header.

**BLOCKED — a genuine, confirmed premise gap, not a script defect.** Running the built tool live
against production (`https://blackouttrades.com/api/admin/zerodte/tier-export?days=19`, 84 total
committed 0DTE plays since 2026-08-25) found that **`discovery_origin` was never exposed by any
live route** — not `/record` (aggregate-only, no per-play origin field anywhere in
`record.ts`/`buildZeroDteRecord`), not `tier-export` (which forwards `entry_premium`/`top_strike`/
`expiry`/tier but had never forwarded `discovery_origin`, even though `entry_context.discovery_
origin` has been persisted at commit since before PR #2846 — confirmed live in `scan.ts`'s real
commit path, `buildZeroDteEntryContext({ ..., discovery_origin: s.discovery_origin }, ...)`). So
the task's premise ("pull BREAKOUT-origin plays via /record or tier-export") did not hold against
current production — not specific to BREAKOUT; every origin is equally unidentifiable via any live
route today. This PR ships the missing forwarding (`ZeroDteTierExportRow.discovery_origin`, additive,
read-only, unit-tested — mirrors exactly why `entry_premium`/`top_strike`/`expiry` were added to
this same route for the C-tier/untiered exit-mode A/B). Because `discovery_origin` is a persisted
`entry_context` column value, not something computed at request time, **once this PR deploys the
already-existing 19+ days of historical rows immediately become BREAKOUT-attributable** — no new
data needs to accumulate first.

**Mechanics proven against real live data anyway** (smoke test, not a claim about real BREAKOUT
attribution): re-screening the real 2026-09-09 grouped-daily snapshot (12,508 rows) for a real
committed short play reproduced 539 real qualifying short movers, a real dynamic cap of 220, and
correctly diverging real rankings for that name — gain_over_range rank 56 (KEPT) vs momentum rank
314 (NOT kept) — the exact mechanism (a decent-gain, weak-close name that momentum's `gain ×
close_strength` penalizes hard and gain_over_range does not) the 2026-08-07 finding's "mechanism"
row described. The pipeline works; only the origin tag is missing pre-deploy.

**Re-run once this PR is live:**
```
node --import tsx scripts/audit/breakout-gain-over-range-option-pnl-ab.mjs --json
# or, before --min-n=15 real plays accumulate feels safe:
node --import tsx scripts/audit/breakout-gain-over-range-option-pnl-ab.mjs --since=2026-08-25 --json
```
No gate/ranking changed by this entry — this is a measurement blocked on its own enabling plumbing,
not evidence for or against the current ranking either way.

## Edge cases / scenarios still to simulate
VIX-regime buckets; trend-day vs range-day; fade-the-open vs follow; gamma-regime (trade toward the
flip / avoid pinned-to-wall); exit-engine replication vs hold-to-close; SPX/NDX index 0DTE; whole-market
banger with a realistic scale-out exit rule (quantify realized vs maxRet); news/catalyst-day conditioning;
half-days / OPEX / triple-witching; bid-ask slippage realism at entry.
