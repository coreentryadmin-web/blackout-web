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

## Edge cases / scenarios still to simulate
VIX-regime buckets; trend-day vs range-day; fade-the-open vs follow; gamma-regime (trade toward the
flip / avoid pinned-to-wall); exit-engine replication vs hold-to-close; SPX/NDX index 0DTE; whole-market
banger with a realistic scale-out exit rule (quantify realized vs maxRet); news/catalyst-day conditioning;
half-days / OPEX / triple-witching; bid-ask slippage realism at entry.
