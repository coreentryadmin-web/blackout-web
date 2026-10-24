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

**Update 2026-09-17 — independent re-check (`zerodte-confluence-floor-outcome-backtest.mjs`),
G-12's own live `confluence_floor` gate. Entry-time sensitivity confirmed real; the 2-conf "edge
bucket" claim does NOT reproduce at either entry time. No gate changed.** Built the confluence-floor
sibling of the score-floor re-check (same shape: real `deriveZeroDteSetups` per historical session
day, a REAL confluence read via `computeIntradayRead`/`marketBias`/`computeConfluence` — the exact
functions `scan.ts`'s own `attachConfluence` calls — computed AS-OF a fixed entry time, graded on
real Polygon minute bars with the favorable-first underlying-continuation proxy). First run used
10:00 ET (matching the score-floor script's own default, chosen for G-2's unlock, not E3's own entry
time) and came back **INVERTED** (18 sessions, n=415: 0-conf 32.7% WR, 1-conf 17.9%, 2-conf 13.4%,
ρ=−1.00) — but re-running at **11:00 ET (E3's own actual entry time)** materially changed the
picture:

```
                              0-conf   1-conf (standard)   2-conf (early-window/E3 edge)
@10:00 ET (n=415):            32.7%        17.9%                 13.4%    -> INVERTED, rho=-1.00
@11:00 ET (n=415):             24.3%        24.8%                  9.6%    -> SPREAD WITHOUT ORDER, rho=-0.50
```

Two distinct findings fall out of comparing the two runs:
1. **The 2026-09-08 loosening's own justification (1-conf should be ~flat vs 0-conf, not negative)
   HOLDS UP at the correct entry time** — at 11:00 ET the delta is +0.6pp (vs a concerning −14.7pp
   at the mistimed 10:00 ET run). Grading from a fixed 10:00 ET entry — a documented negative-EV
   entry point per E2 above, independent of any gate — measurably distorts this specific comparison.
2. **The 2-conf bucket (E3's own claimed +15.9% EV edge, also today's `ZERODTE_CONFLUENCE_MIN_EARLY`
   requirement) grades WORST at BOTH entry times** (13.4% @10:00, 9.6% @11:00) — this part is
   entry-time-INDEPENDENT and does not reproduce E3's original edge claim under this proxy at all.

**Same scope caveats as the score_floor re-check apply**: favorable-first underlying-continuation
proxy, not real option premium P&L (E3's own methodology); FLOW-origin setups only. **No gate
changed** — same single-sample-caution discipline as every other calibration A/B in this toolkit.
This also raises an open, not-yet-answered question for the score_floor INVERTED result logged in
this doc's E6 section below (also graded from a 10:00 ET entry): does IT also partly resolve at
11:00 ET? A re-run is in progress; results will be appended to E6 once it lands. Full write-up:
`docs/audit/findings-staging/2026-09-17-zerodte-confluence-floor-entry-time-sensitivity.md`.

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

**Update 2026-09-17 — RE-OPENED, ordering REVERSED on a fresh re-run, no gate changed.** Re-ran
`tier-exit-mode-ab.mjs --days=90 --json` live (90-day window, n=100 graded, population=115 — the
same tool, same mechanics as the 2026-08-29 run above). The win-rate ordering flipped: **ratchet
31.0% WR / −7.0% avg P&L vs trim_scale 38.0% WR / −7.7% avg P&L** — trim_scale is now +7.0pp ahead
on win rate (was −7.1pp), and the avg-P&L gap that was ratchet's main justification (+12.8pp)
collapsed to a noise-level +0.7pp. Driver: ratchet reached a true `doubled` close on only 12/100
rows this run (vs 29/100 for trim_scale banking a `runner_close` partial), with 35/100 rows giving
back gains via the trailing-stop `ratchet` exit instead. **Still no gate changed** — n=100 with a
near-zero P&L gap cannot separate either ordering from noise on its own, same single-sample-caution
discipline as the 2026-08-29 update above; this is a re-opened question, not a reversed decision.
See `docs/audit/findings-staging/2026-09-17-zerodte-tier-exit-mode-ab-reversed.md`. Next step: a
third re-run in a few more weeks — if the reversal holds or deepens, that's the trigger to revisit
`resolveExitModeForTier`'s default, not this run alone.

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

### Live trim_scale tranche-banking never fires in production — CONFIRMED, severity P1, operator decision pending (2026-10-20)

**WHY THIS EXISTS.** Member live-book audit directive: "Verify whether Night Hawk's intended
trim ladder is +25%, +50%, and +100%... Explain which rules closed today's winners before the
first trim, especially the ratchet exits. Check whether those rules conflict with the
intended ladder, and test any correction before changing production."

**The intended ladder, verified against the real shipped constants** (`TRIM_SCALE_RULES`,
`exit-engine.ts`): tranche_fraction = **1/3** (not half), banked at TWO regime-conditioned peak
thresholds — `neutral: [20%, 50%]`, `trend: [40%, 80%]`, `range: [15%, 40%]` — then the last
third runs to the **+100%** target (`PLAN_RULES.target_pct`) or the plan stop/time-stop. The
module's own doc comment describes the E5-measured recommendation as "⅓@+25% / ⅓@+50%" — the
SHIPPED neutral constant is actually **+20%**, not +25%; a minor, separate discrepancy between
the documented recommendation and the live constant, flagged here but not itself the main
finding. Between tranches, the remaining position is protected by the SAME peak-scaled shared
floor the ratchet mode uses (`0.4 x peak`, via `trimScaleFloorPct`/`ratchetFloorPct`); once both
thirds are banked (or peak clears target), a flat **+50%** "runner floor" protects the last
third.

**What's actually closing today's (and every day's) trim_scale-committed winners: the SAME
shared floor the ratchet path uses — never a trim.** Checked every one of today's 19 closed
trades: 13 were frozen at commit as `exit_policy_at_commit: "trim_scale"` (A/B-tier, which
SHOULD get the ⅓/⅓/run ladder). **Every one of the 13 exited via a `categorizeExitReason`
"ratchet" bucket** (`ratchet_early_profit_floor`/`ratchet_breakeven_floor`/etc.), `timeline_tranches: null`
(no partial bank ever recorded), `mfe_capture_pct` consistently ~35-46% of peak — the exact
signature of a pure `peak*0.4` floor dump, not a banked-then-run ladder. Cross-checked against
the AUTHORITATIVE (not display-only) `managed_outcome`/`managed_source` fields on
`GET /api/market/zerodte/record` across a real 14-day window (109 trim_scale rows with a WS-11
reconstruction present): **every single one** shows `managed_source: "engine"` with a single,
whole-position exit as the REAL, as-managed outcome — never a genuine partial scale-out —
while several of those SAME rows' own WS-11 bar-walk reconstruction (`entry_context.executable.tranches`)
independently shows a real, achievable first-tranche trigger price the underlying genuinely
reached during the position's real holding window (e.g. MSTR 2026-10-16: reconstruction shows
a real tranche at 12:35 ET banking 1/3 at +16.13%, a second at 13:06 ET banking another 1/3 at
+45.16% — real price levels that really occurred — yet the row's REAL, live-managed outcome was
a single "ratchet" exit at +5%, zero tranches ever actually banked). `managedGradeView`
(record.ts) correctly does NOT substitute the reconstruction's number for the real outcome
here (its own documented precedence rule: a real exit whose reason needs live state a bar-walk
can't replay — a ratchet-style floor, thesis-break, flat-timeout — always wins, because
continuing the bar-walk past an already-closed position is a FICTITIOUS continuation, not a
correction) — so this is NOT a case of members being shown a wrong number. It IS a case of the
real, live position management never doing what its own frozen policy promises.

**The mechanism this is consistent with** (`exit-sync.ts`): `resolveTrimBankLive()`/
`resolveTrimRegimeLive()` gate whether the live engine reads a REAL persisted `trims_taken`
count, or instead RECOMPUTES it fresh every tick via `trimTranchesArmed(peak, regime)` — the
EXACT SAME function `decideTrimScale` (exit-engine.ts) calls to compute its own `armed`
variable, on the SAME inputs. When effectively off, `trimsTaken === armed` by construction on
every call, so `trimAvailable = armed > taken` can never be true — the trim-ladder's own TRIM
action is structurally unreachable, and every position instead falls straight through to the
shared floor-breach EXIT, indistinguishable from a true ratchet row. This exact failure mode
is independently documented in `FINDINGS.md`'s own history (`ZERODTE_TRIM_BANK_LIVE` "merged
disarmed... flipping it live is a deliberate operator follow-up" — and `ZERODTE_TRIM_REGIME_LIVE`
"stays off") as the KNOWN, NAMED bug this exact flag was built to fix. Separately, EVERY
`exit_policy_snapshot.trailing_rule` checked today shows `active_regime=neutral` regardless of
the row's own `session_regime` column (`range` in several cases) — directly, observably
confirming `resolveTrimRegimeLive` is NOT honoring the stamped regime live, consistent with it
being off. **This sandbox has no access to the live `ZERODTE_TRIM_BANK_LIVE`/
`ZERODTE_TRIM_REGIME_LIVE` env values** (no AWS creds this session) — the inline code comments
next to each function's `return true` fallback claim "ON by default (2026-09-03)," which
directly contradicts both FINDINGS.md's own account and 14+ real days of observed production
behavior. Whether that is a stale comment describing a flag that was later reverted, or an
explicit env override in the deployed secret, is NOT resolved here — only the OBSERVED,
EMPIRICAL production behavior (zero genuine tranche banks across the entire sample) is a
confirmed fact.

**Test run before any change (per the member's own instruction — "test any correction before
changing production"):** `scripts/audit/zerodte-trim-bank-live-ab.mjs` replays the real
historical trim_scale-committed population on real Polygon minute bars through the REAL,
imported `exit-engine.ts` functions, comparing `broken_live` (today's real shipped mechanics —
`trimsTaken` forced equal to `armed`) against `fixed` (a genuine, monotonic `trims_taken`
latch). First run, 45-day window, capped samples: **most real trim_scale rows never reach a
peak high enough to arm even one tranche at all** (median real peak across 249 real rows:
+5.5%, well under the neutral regime's +20% first trigger; only 45/249, 18%, ever reach
+20%+) — so a capped random sample thins the population this question actually has power over.
First pass (n=23/25 per half, cap 25): mean_delta TRAIN +0.82% (CI [-0.84, +2.48]), VALIDATION
-0.01% (CI [-0.43, +0.40]) — thin (3/23, 2/25 rows ever armed a tranche). Re-run with cap 100
(n=96/90 graded, 8/96 and 19/90 rows now arming a tranche): mean_delta TRAIN -0.39% (CI
[-1.31, +0.53]), VALIDATION -0.61% (CI [-1.55, +0.34]) — still INCONCLUSIVE (CI straddles zero
both times), but now consistently slightly NEGATIVE in both halves.

**v2 (member follow-up — "verify the effective flags... test each flag separately and
together, using realistic fills, costs, and out-of-sample results"):** rewrote the script to
test all FOUR flag combinations (`neither`/`bank_only`/`regime_only`/`both`) plus a fifth cell
substituting the member's literal +25% first trigger for the shipped +20%, and switched from a
bar-derived mechanical fill to a REAL point-in-time NBBO quote at each fill's own bar timestamp,
filled at the bid (the same conservative, executable-side convention `executableFill`/
`live_pnl_pct_exec` already use) — a genuinely more realistic cost model than v1's. Also
directly verified the two flags' EFFECTIVE production state via two independent, non-inferred
signatures rather than the raw env values (unreadable from this sandbox, no AWS creds): (1)
every real `exit_policy_snapshot.trailing_rule` checked shows `active_regime=neutral` even for
rows whose own `session_regime` column says `range` — REGIME_LIVE is off, directly observed,
not guessed; (2) zero genuine partial-tranche banks across 122 real rows checked (109
reconstructed + 13 live), despite ~18% of the population clearing a high-enough peak —
statistically implausible if BANK_LIVE were genuinely on. Both signatures agree: **both flags
are confirmed off in production today.**

Result, 45-day window, n=57/55 graded per half (cap 60):

```
TRAIN      BANK_LIVE only: delta +0.74% CI[-0.27,+1.74]   REGIME_LIVE only: delta -0.03% CI[-0.09,+0.03]
           BOTH:           delta +0.77% CI[-0.19,+1.74]   LITERAL (+25% trigger): delta +0.77% (identical to BOTH)
VALIDATION BANK_LIVE only: delta -0.21% CI[-2.32,+1.89]   REGIME_LIVE only: delta  0.00% CI[ 0.00, 0.00]
           BOTH:           delta -0.09% CI[-1.94,+1.75]   LITERAL (+25% trigger): delta -0.09% (identical to BOTH)
```

Every cell INCONCLUSIVE (CI straddles zero), and — unlike the v1 result — the point estimate
now **flips sign between TRAIN and VALIDATION** for both BANK_LIVE and BOTH, a weaker and more
honest "no evidence of benefit either way" result than v1's consistent-negative read; the
realistic bid-side fill appears to erase most of what looked like a mild edge under v1's
frictionless mechanical fill. REGIME_LIVE alone never banks anything (expected — its effect
runs entirely through the shared floor's trend-regime dead-zone branch, a rare case in this
sample) and its own delta is statistically zero in both halves. The LITERAL +25%-trigger cell
produced byte-identical results to the shipped +20% cell in both halves (same rows banked, same
count) — in this sample, the 5-point gap between the member's stated intent and the shipped
constant never actually changed which bar a tranche armed on, so it does not appear to be the
source of any of this question's uncertainty.

**No gate, exit rule, or env flag changed by this investigation (either round).** This is a
confirmed, high-severity (every A/B-tier play, every session, for at least 14 real days)
finding that the live trim ladder's protective/partial-profit-taking mechanism does not fire —
but fixing it is an env-var flip, not a code change, and the codebase's own calibration-first
discipline (FINDINGS.md) explicitly reserves that decision for a deliberate operator review once
the economic case is clear. Two independent real-cost backtests (v1 and v2, different fill
models) now agree the economic case is NOT clear on current evidence: v1 leaned mildly negative,
v2 (the more realistic fill model) is a coin flip with the sign depending on which half of the
data is looked at. **Protective and time exits (hard stop, thesis-break, flat-timeout, the
shared floor itself) are all independently verified intact and firing correctly, and are checked
on every single bar in every cell before any trim/floor logic — a position is never forced to
wait for a profit target** — this finding is specifically about the MISSING partial-profit-taking
step, not about any of the capital-protection rules.

**Recommendation:** do not flip `ZERODTE_TRIM_BANK_LIVE`/`ZERODTE_TRIM_REGIME_LIVE` on the
evidence gathered so far. The mechanism genuinely not firing live is a real, confirmed defect
relative to the documented design — but "the ladder doesn't run" and "running the ladder would
make money" are two different claims, and only the first is established. Two rounds of
real-cost, held-out testing have not found a reliable edge either way. If the flags are flipped
anyway (an operator call this investigation does not make), do so as a small, monitored,
reversible rollout — not a blind flip — given the sign instability between TRAIN and VALIDATION
in the one real-cost model built so far.
### Loss-side early de-risk A/B — the exit ladder's missing symmetric half, MEASURED, no gate changed (2026-10-20)

**WHY THIS EXISTS.** A live member audit of today's open book (2026-10-20) flagged a real,
visible asymmetry: closed winners averaging ~+8% (ratchet/trim_scale arming off peaks as low
as +5-20%) while numerous OPEN positions sat at -20% to -34% with nothing between -10% and
the -50% hard stop able to touch them. Reading `exit-engine.ts` confirms this is structural,
not an artifact: the shipped profit ladder (both modes) actively de-risks winners early and
often; the ONLY loss-side protections are the -50% hard stop, thesis-break (evidence-based —
a Cortex veto or >=2 clustered opposes exceeding the entry's own margin), and
`flat_theta_bleed` (unreachable once a position has moved past -10%, i.e. unreachable for
exactly the population sitting at -20% to -34%). E5 above already measured and documented
the PROFIT side's own cost (the ratchet "buys win-rate, not EV — scratches runners"); the
LOSS side had never been measured at all. Member directive: "test proposed improvements on
separate historical sessions with realistic costs before changing production rules."

**THE CANDIDATE.** `scripts/audit/zerodte-loss-side-exit-ab.mjs`: a LOSS-side tranche,
symmetric in spirit to the existing profit ladder, layered ONLY onto the still-fully-open
loser population (never touching a row that already banked a profit tranche, never touching
the winner side) — once peak-to-current drawdown reaches a trigger threshold AND the
position has aged past a minimum, exit the whole remainder immediately rather than holding
to the hard stop/thesis-break. Pulls the REAL historical committed population (`GET
/api/admin/zerodte/tier-export`, same source `tier-exit-mode-ab.mjs` uses), replays each
row's REAL contract minute bars under its OWN frozen `exit_policy_at_commit` using the REAL,
imported `exit-engine.ts` functions (`ratchetFloorPct`/`trimTranchesArmed`/
`trimScaleFloorPct`/`ratchetTargetReached`/`TRIM_SCALE_RULES` — never reimplemented), with
real point-in-time NBBO entry/exit quotes and the same $100-multiplier-correct fee model this
toolkit's sibling real-cost scripts already use. Thesis-break/`flat_theta_bleed` are NOT
replayed (no point-in-time Cortex evidence to reconstruct them from historical bars alone —
same disclosed simplification `swing-early-trim-ab.mjs` uses for its own sibling question) —
this measures the mechanical profit-ladder + hard-stop + time-stop skeleton only. Chronological
TRAIN/VALIDATION split, held out.

**First live run, 45-day window, n=29 graded per half (capped), 4 candidate thresholds
(-15%/age>=10min, -20%/age>=15min, -25%/age>=15min, -30%/age>=20min):**

```
TRAIN:      all 4 thresholds mean_delta NEGATIVE (-2.48pp .. -0.08pp), all CI95 straddle zero
VALIDATION: all 4 thresholds mean_delta NEGATIVE (-3.39pp .. -2.37pp), all CI95 straddle zero
```

No single threshold's CI clears zero in either half (every cell reads INCONCLUSIVE by the
strict bar), but the DIRECTION is consistent across all 8 cells (4 thresholds × 2 halves):
the candidate loss-side cut underperforms the baseline every time, and the effect is LARGER,
not smaller, in the held-out validation half. **This is the opposite of a confirming result**
— a naive, context-free P&L-triggered early loss cut is not supported by real data, and the
trend argues against it rather than toward it. The likely mechanism is the same one E5 already
documents for the profit side: 0DTE intraday moves are noisy enough that a fixed threshold cuts
real chop that would have mean-reverted before the actual time-stop, exactly as a tight
trailing stop on the profit side was already shown to scratch real runners. This is also a
coherent (if unmeasured-until-now) justification for why the existing design relies on
EVIDENCE (thesis-break) rather than raw P&L to cut a loser early — evidence can distinguish a
real breakdown from noise; a P&L threshold alone cannot.

**No gate/exit rule changed.** The asymmetry is real and now measured on both sides (E5:
profit side costs EV; this: a naive loss-side fix doesn't clearly help either) — this closes
the "is the obvious fix actually a fix" question for the P&L-threshold shape specifically,
without claiming the asymmetry is optimal or closing the broader question. A SMARTER
loss-side candidate — e.g., a looser EVIDENCE-weighted margin specifically for the loss
direction (symmetric to thesis-break's own cluster+margin design, not a bare % trigger), or
conditioning the trigger on regime/age differently — remains open and unmeasured; this run
only rules out the simplest, most obvious shape. Re-run with a larger population (today's
45-day/n=29-per-half cap was chosen for a reasonable API budget) before concluding the
direction is final.

### Range-regime sub-+15%-peak dead zone — live same-day observation, 2026-09-17, NOT YET MEASURED

Distinct from the trend-regime dead zone above (that one is about peaks in [20%, 40%) that armed
the shared breakeven floor but not trend's own +40% first tranche). This is the analogous gap for
**range regime's own +15% first-tranche trigger**: for range, +15% sits BELOW the shared ratchet
arm point (+20%), so per `inTrimScaleDeadZone`'s own doc, "range... crosses AT OR BEFORE the arm
point" — meaning a range peak that never clears +15% gets **zero protection of any kind**, not
even the half-of-peak dead-zone floor `trimScaleFloorPct` gives trend. By design, not a bug: a
peak below the tranche trigger simply hasn't earned a floor.

Live same-day forensic pass on 2026-09-17's ledger (Night Hawk 0DTE 15-min audit cadence) found
all 3 of the day's `thesis_break`-exited plays (TEM, SMCI, CMPS — the 4th, SNDK, was a plain
`plan_stop`) shared the identical shape: real double-digit peaks (TEM +14.32%, SMCI +12.67%, CMPS
+11.84%) — all clustered just under range's +15% trigger, none reached it, none armed anything —
followed by a `thesis_break:gex-walls` veto that exited the remaining position at a materially
worse mark (TEM -25.95%, SMCI -26%, CMPS -27.63%), a 38-40pp round-trip from peak to exit on every
one. 3/3 same shape, same session — clears the standing 3-instance noise threshold for *naming*
the pattern, but is a single session day and cannot itself justify a threshold change (exactly the
caution the trend dead-zone item above already states for its own, better-populated case).

**Open question, not yet measured:** would a lower first-tranche trigger for range (or a
trend-style partial dead-zone floor extended below +15%) have banked something on these three
without materially hurting range-regime plays that go on to hit their real target? Needs the same
rigor as `regime-dead-zone-ab.mjs` above — real historical range-regime rows via
`GET /api/admin/zerodte/tier-export`, re-graded through the shipped `evaluateExitState` at a
candidate lower trigger, over enough sessions to separate signal from one day's regime. **No gate
changed.** Re-check as the range-regime population accumulates; do not act on this single day.

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

### Gate-overlap ablation, PRIMARY-CODE ONLY (G-1/G-4/G-10/G-12/G-13) — built 2026-09-09/10, re-run 2026-09-17 (G-13 now MEASURABLE)

**Why this was built.** The operator's CTO review (2026-09-09) asked whether G-1 (tape alignment), G-4
(VIX regime), G-10 (intraday structure), G-12 (confluence floor) and G-13 (flow-accumulation conflict)
measure overlapping "does the environment agree with this direction" phenomena. The same-day fix
(`docs/audit/findings-staging/2026-09-09-zerodte-rejection-log-primary-gate-only.md`) made
`zerodte_scan_rejections.blocks_json` start recording EVERY failing gate on a row, not just the primary
`gate_failed` — but that field needs to accumulate a real sample before the FULL overlap study is
possible. That finding's own closing line named the smaller thing buildable immediately: a
primary-gate-only Blocked WR/EV vs Passed WR/EV comparison via the already-existing counterfactual
grader (`skip-grading.ts`). That tool now exists:
`scripts/audit/zerodte-gate-primary-ablation.mjs` (pure aggregation in
`scripts/audit/lib/gate-primary-ablation-eval.mjs`, 17 unit tests). It:
- Maps each named gate to its exact rejection code(s), read directly off `gates.ts`'s own `// G-N —`
  comments (not inferred): G-1 → `no_market_bias`/`tape_alignment`; G-4 → `vix_extreme`/`vix_elevated`/
  `vix_unavailable`/`condor_vix_regime`; G-12 → `confluence_floor`; G-13 → `flow_accumulation_conflict`.
  **G-10 maps to zero codes** — it was DEMOTED to score-only on 2026-07-27 (see that line's own comment
  in `gates.ts`) and has pushed no block since, so it is reported `NOT_MEASURABLE` by construction, never
  silently defaulted to an empty-but-plausible-looking row.
- Aggregates the calibration report's existing `blocked_value[]` (already grouped by primary
  `gate_failed`, `GET /api/market/zerodte/calibration`) across each gate's code family, with a Wilson 95%
  CI on the merged win rate.
- Compares against the committed ledger's `mechanical` rollup (`GET /api/market/zerodte/record`) — the
  SAME fixed −50%/+100%/15:50-ET plan grade the blocked-side counterfactual uses, not the as-managed
  headline (a different, variable exit policy) — so Blocked and Passed are graded under identical
  physics, per skip-grading.ts's own stated rule.
- Reports a clearly-labeled MODELED "assumed EV" for the blocked side (win rate run through the fixed
  plan payoff) distinct from the passed side's REAL measured premium P&L — rejection rows carry no OCC,
  so skip-grading can only grade them underlying-direction-only; never blends the two.
- Distinguishes **"no rejections logged"** from **"rejections logged but 100% ungradeable"** — collapsing
  those into one `n=0` line would silently hide that a gate DID fire.

**First live run (2026-09-10, 90-day window, `--days=90`):** committed-ledger baseline (Passed) is
solid — **n=363, WR=30.6%, mechanical EV=−11.4%**. But the Blocked side is currently **unmeasurable for
all five gates**, and the reason is NOT small sample size specific to these gates:
```
G-1   (no_market_bias/tape_alignment):        5 rejections logged, 5/5 ungradeable — ALL_UNGRADEABLE
G-4   (vix_extreme/vix_elevated/...):         0 rejections logged in-window            — NO_REJECTIONS_IN_WINDOW
G-10  (score-only since 2026-07-27):          structurally 0 codes                      — NOT_MEASURABLE
G-12  (confluence_floor):                     1 rejection logged, 1/1 ungradeable       — ALL_UNGRADEABLE
G-13  (flow_accumulation_conflict):           9 rejections logged, 9/9 ungradeable      — ALL_UNGRADEABLE
```
Pulling the FULL `blocked_value[]` (every gate code the report knows about, not just these five) showed
this is **platform-wide, not specific to the five named gates**: **all 18 gate codes present in the
90-day window show `n=0` graded against 2,000 ungradeable rows** (2,000 is `fetchGradedSkips`'s own fetch
cap — the true ungradeable total may be higher), including high-volume codes like `score_floor` (320
ungradeable), `thesis_rank_reject` (464), `late_afternoon` (337), and `min_gross` (206). The tool now
self-detects and prints this (`platformWideSkipGradingHealth` / the `systemic_zero_graded` flag) so a
future run can never mistake "these five gates are quiet" for "the whole grader is stalled" again.

The dominant ungradeable reasons across the sample are **"no underlying bar at/after the block time
inside the plan window"** and **"no bar data available for the session"** — the SAME generic-reason
class the 2026-08-29 finding (documented in `skip-grading.ts`'s own module comment) previously traced to
a swallowed Polygon fetch failure inside `fetchAggBars`, supposedly fixed by routing through
`fetchAggBarsWithDiagnostics`. Reading that function today: it DOES correctly distinguish a genuine fetch
failure (`data == null`, a real thrown/non-2xx error) from a genuinely empty result set (`data` present,
`results` empty/absent) — and `skip-grading.ts` only swaps in the specific `"underlying bar fetch threw:
..."` reason when a real failure was captured. **None of the sampled ungradeable rows carry that specific
message** — every one reads the generic reason — which means, per that function's own logic, Polygon is
reporting a SUCCESSFUL response with no matching bars for essentially every rejected candidate's session
date, or the block timestamp being compared against those bars is systematically landing outside the
range that exists. Neither of those was verified further here (out of scope for this measurement task —
flagged as a follow-up rather than root-caused blind). ~~A plausible, NOT YET VERIFIED, hypothesis worth
checking first: `runSkipGrading` derives `blockedAtMs` via `Date.parse(row.observed_at)` — if
`observed_at` round-trips through Postgres/pg without an explicit UTC marker, a timezone
misinterpretation would systematically push `blockedAtMs` outside every session's available minute-bar
range, producing exactly this "bars exist for the day, but none at/after the (wrong) block instant"
signature.~~ **UPDATE (2026-09-12): this specific hypothesis was traced against the real code and
REFUTED** — `observed_at` is a genuine `TIMESTAMPTZ`, no `setTypeParser` override exists anywhere in
this repo, and `String(Date) → Date.parse(string)` round-trips to the exact same epoch millisecond
regardless of process `TZ` (verified empirically under `UTC`/`America/New_York`/`Asia/Kolkata`) — V8's
`Date.parse` is the literal inverse of its own `toString()` format, offset and all. **The real bug was
one field over and now FIXED**: `session_date` (a plain `DATE` column, no timezone) round-trips through
node-postgres as a JS `Date` at UTC MIDNIGHT for that calendar day, and the OLD code ran that
midnight-UTC instant through `etYmd()` — built for converting a REAL epoch instant to its ET calendar
day, not for reading a `DATE` column — which, because America/New_York sits behind UTC, silently
returned the day BEFORE the row's real, stored `session_date` on every single row, every day of the
year (deterministic, not occasional). That wrong date drove the underlying-bar fetch to the WRONG
session's minute bars, so no bar ever landed at/after the (correctly-computed) `blockedAtMs` — exactly
this section's observed "bars exist for the day, but none at/after the block instant" signature, just
off the DATE column rather than the TIMESTAMPTZ one. Fixed in
`docs/audit/findings-staging/2026-09-12-skip-grading-session-date-utc-midnight.md` by reading the UTC
Y-M-D through `db.ts`'s own `isoDateString` helper (the established idiom for every other `DATE` column
in this codebase) instead of `etYmd()`. **Re-run
`scripts/audit/zerodte-gate-primary-ablation.mjs --days=90` once a fresh population of rows has been
graded under the fix** — the primary-gate-only ablation below should now produce real Blocked-side
numbers instead of `n=0` across the board.

**No gate changed by THIS measurement pass** (the skip-grading plumbing fix above is a separate,
already-shipped fix, not a gate change) — the ablation study itself remains evidence-gathering only,
same discipline as every other A/B tool in this file. **Status: the primary-gate-only ablation the CTO
review asked for is now BUILT and RUNNABLE — previously blocked by the platform-wide skip-grading gap
above, now fixed; re-run `node --import tsx scripts/audit/zerodte-gate-primary-ablation.mjs
--days=90` once that gap is investigated/fixed** (a distinct piece of work, flagged as a follow-up
suggestion rather than attempted inline here). Until it is, neither the primary-gate-only nor a future
full `blocks_json`-based ablation can produce a real Blocked WR/EV number for any gate.

**RE-RUN 2026-09-17 (0DTE nonstop-focus session) — the skip-grading fix unblocked real numbers for
the first time, and G-13's is a genuine flag worth reading carefully.** `node --import tsx
scripts/audit/zerodte-gate-primary-ablation.mjs --days=90` (90-day window, committed-ledger baseline
n=400, WR=30.8%, EV=−11.7%, all real premium P&L):
```
G-1   (no_market_bias/tape_alignment):   BLOCKED n=7   WR=42.9%  — verdict LOW_N (below the 10-floor, hint only)
G-4   (vix_extreme/.../unavailable):     BLOCKED n=0                — NO_REJECTIONS_IN_WINDOW
G-10  (score-only since 2026-07-27):     structurally 0 codes       — NOT_MEASURABLE (unchanged, expected)
G-12  (confluence_floor):                BLOCKED n=0                — NO_REJECTIONS_IN_WINDOW
G-13  (flow_accumulation_conflict):      BLOCKED n=12  WR=75.0% (95% CI [46.8%, 91.1%]) — verdict MEASURABLE
```
**G-13 clears the min-n floor for the first time and the number is striking:** the population G-13
BLOCKED (flow accumulation opposing the setup's direction) would have won **75.0%** of the time
(modeled EV +62.5% through the fixed −50/+100 payoff) — more than DOUBLE the 30.8% WR of what the desk
actually committed over the same 90 days. That is a −44.2pt gap in the WRONG direction for a gate that
exists specifically to filter out weak setups: on this sample, G-13 is disproportionately blocking
setups that would have WON, not setups that would have lost.

**Read this with the same caution the script's own header insists on, not as grounds to touch the
gate:**
- n=12 is thin — above the 10-floor so it clears `MEASURABLE` rather than `LOW_N`, but still a small
  sample; a 95% CI of [46.8%, 91.1%] is wide enough that "75%" could easily regress toward the mean on
  a larger pull.
- This is a MODELED win/lose call off the underlying's direction only (rejection rows carry no OCC, so
  there is no real option-premium P&L for the blocked side) against the REAL mechanical-plan premium
  P&L on the passed side — not an apples-to-apples EV comparison, exactly as the script's own "never
  blend the two" note says.
- Primary-gate-only attribution: G-13 evaluates AFTER G-1/G-4/G-10/G-12 in `evaluateZeroDteGates`, so
  its n=12 is already the UNDERCOUNTED tail (any candidate that also failed an earlier gate is
  attributed there instead) — the true G-13-blocked population is at least 12, likely larger.
- G-1's n moved 5→7 and G-13's moved 9(all-ungradeable)→12(all-gradeable) since the 2026-09-12
  `session_date`/`etYmd()` fix, confirming the fix is doing its job — grading was the blocker, not gate
  behavior — but the underlying rejection VOLUME for these gates is still small over 90 days, so this
  remains a first real look, not a settled verdict.

**No gate changed by this run.** The G-13 number is exactly the kind of signal this tool was built to
surface (INTENTIONAL-DESIGN.md discipline: evidence first, gate calibration only after a real sample
says so) — worth a dedicated re-run as the window's rejection volume grows and/or a widened window,
before any decision on G-13's flow-accumulation-conflict threshold. Flagging here rather than opening a
gate-change PR on n=12.
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

**Update 2026-09-17 — RE-RUN with the buckets split to match G-17's real live boundary, verdict
ESCALATED from `SPREAD WITHOUT ORDER` to `INVERTED`. No gate changed.** G-17 was restructured
2026-09-09 (the day AFTER this backtest's last graded session, 2026-09-08) from a flat 65-74
admission rule into two sub-bands with different real admission paths — 65-69 now rejects
UNCONDITIONALLY (`single_rail_corroboration`), 70-74 is CONDITIONAL (needs confluence≥2 + clean
tape/VIX/execution) — so the old merged "65-74 (clears today)" bucket could no longer say whether
an ordering problem sits in 65-69, in 70-74, or both. Split `SCORE_BUCKETS` in
`scripts/audit/lib/score-floor-backtest-eval.mjs` to match (`65-69 (G-17 unconditional reject)` /
`70-74 (G-17 conditional admission)`), then re-ran with `--sessions=28` (up from 18) to include
sessions after the 2026-09-09 restructure:

```
score band                              n     win%      avg maxRet%
0-39                                    60    25.0%      0.79%
40-54                                  223    23.3%      0.75%
55-64 (blocked today)                   88    20.5%      0.69%
65-69 (G-17 unconditional reject)       49    14.3%      0.63%
70-74 (G-17 conditional admission)      13     7.7%      0.38%   (excluded from verdict, n<30)
75-84                                    3    66.7%      1.46%   (excluded, n<30)
```

**Headline comparison (55-64 blocked vs 70-74, the band that actually clears live today):**
70-74 graded **7.7%** vs 55-64's **20.5%** — a **−12.8pp delta AGAINST the floor's implied
ordering**, similar direction to the 2026-09-10 run but now measured against the population G-17
ACTUALLY admits (not the old merged 65-74 mix). Thin at n=13 — read as directional, not conclusive,
on this comparison alone.

**G-17 band-split check — does 70-74 (conditional admission) actually grade better than 65-69
(unconditional reject), justifying treating them differently?** No: 70-74 graded **7.7%** vs
65-69's **14.3%** — a further **−6.6pp**, the OPPOSITE of what G-17's own 2026-09-09 restructuring
comment argues ("a genuinely well-confirmed 70-74 setup should NOT be equally weak EV as an
unconfirmed 65-69 one"). Both bands thin (n=13, n=49) but the direction is consistent with the
rest of this run, not a one-off.

**Verdict (same RANKS / SPREAD WITHOUT ORDER / INVERTED / FLAT discipline, minN=30): `INVERTED`**
— among the four bands with n≥30 (0-39 n=60, 40-54 n=223, 55-64 n=88, 65-69 n=49), win rate falls
monotonically as score rises: 25.0% → 23.3% → 20.5% → 14.3%. Spread 10.7pp, **rank correlation
ρ = −1** (perfect negative rank agreement across the four usable bands — the strongest, cleanest
signal this backtest has produced, an escalation from the 2026-09-10 run's ρ = −0.20 `SPREAD
WITHOUT ORDER`). This is no longer "the bands differ but don't trend" — the trend is real, and it
runs backwards.

**Still no gate changed** — same scope caveats as the 2026-09-10 entry above apply unchanged
(favorable-first underlying proxy, not real premium P&L; `score` alone, not jointly gated with
VIX/confluence/governor/Cortex), and the two bands nearest the live floor boundary (70-74, 75-84)
are both n<30 and excluded from the ρ calculation — so this does NOT by itself prove the 70-74
conditional-admission path is wrong, only that the broader trend across the well-powered bands
(n=49 to n=223) now runs the opposite direction from what the floor assumes, more cleanly than
before. See `docs/audit/findings-staging/2026-09-17-zerodte-score-floor-inverted.md` for the full
write-up and recommended follow-up (grow the 70-74/75-84 samples past n=30, and — per this run's
own stated scope limit — a real-premium re-run of F-2's original methodology at today's larger
sample size, still the standing open item from the 2026-09-10 entry above).

**Update 2026-09-17 (same day) — the open entry-time question above IS answered: partially resolves,
same shape as confluence-floor's own finding, but the G-17-specific comparison gets WORSE, not
better. No gate changed.** Re-ran with `--entry=11:00` (E3's own entry time, the same correction
applied to the confluence-floor sibling above) on the identical 28-session population:

```
score band                              @10:00 ET   @11:00 ET
0-39            (n=60)                    25.0%       15.0%
40-54           (n=224)                   23.3%       25.4%
55-64 (blocked) (n=88)                    20.5%       11.4%
65-69 (reject)  (n=49)                    14.3%       22.4%
70-74 (admit)   (n=13, excluded)           7.7%        7.7%
75-84           (n=3,  excluded)          66.7%       33.3%
```

**Overall verdict changes, same direction as confluence-floor:** `INVERTED` (ρ=−1) at 10:00 →
`SPREAD WITHOUT ORDER` (ρ=0) at 11:00 — the clean monotonic decline does not survive grading from
the correct entry time; 40-54 and 65-69 both grade BETTER at 11:00 than 55-64 does, breaking the
monotonic ordering. Same as the confluence-floor finding: **grading from a fixed 10:00 ET entry — a
documented negative-EV entry point per E2, independent of any gate — measurably distorts this
comparison too.**

But unlike confluence-floor, where the specific concerning sub-comparison (1-conf vs 0-conf)
resolved favorably at 11:00, **this backtest's two specific sub-comparisons split**:
- **Cross-floor (55-64 blocked vs. 70-74 admitted) narrows substantially**: −12.8pp at 10:00 →
  **−3.7pp** at 11:00 (n=13 both times, thin) — the "blocked setups beat admitted ones" concern
  shrinks a lot at the correct entry time, similar in direction to confluence-floor's narrowing.
- **G-17's own band-split rationale (70-74 vs. 65-69) gets WORSE, not better**: −6.6pp at 10:00 →
  **−14.8pp** at 11:00 (n=13 vs n=49) — the conditional-admission band (70-74) now underperforms
  the unconditional-reject band (65-69) by an even wider margin at the timing G-17's own gate logic
  is supposed to matter for. This is the opposite of what a pure mistimed-entry explanation would
  predict for this specific comparison.

**Reading, per this toolkit's single-sample-caution discipline:** the OVERALL score-outcome trend
was likely inflated by the same 10:00-ET mistiming that affected confluence-floor — real evidence
this is at least partly a backtest-methodology artifact, not proof the score formula itself ranks
backwards. But the G-17-specific 70-74-vs-65-69 comparison is NOT explained away by entry timing —
if anything it strengthens — so the standing recommendation to re-run this specific comparison with
real option premium at a larger 70-74 sample (rather than dismissing it as a timing artifact) still
stands. Full write-up appended to
`docs/audit/findings-staging/2026-09-17-zerodte-score-floor-inverted.md`.

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

**UNBLOCKED, MEASURED 2026-09-15 — the enabling PR is live, this is the originally-recommended
validation, finally run.** `discovery_origin` is confirmed forwarded on `tier-export.ts` (`GET
/api/admin/zerodte/tier-export`) in the current `main`. Ran
`scripts/audit/breakout-gain-over-range-option-pnl-ab.mjs --json` against live production (21
trading days since the 2026-08-25 PR #2846 merge, `thin_sample: false` — the overall population
clears the script's own `--min-n=15` bar):

- **Part A (directly observed, pure-BREAKOUT-only real committed plays):** n=74, win rate 47.3%,
  avg P&L **−1.3%**.
- **Part B (counterfactual split — MOMENTUM_ALSO vs GAIN_OVER_RANGE_EXCLUSIVE):**
  `MOMENTUM_ALSO` (both rankings would have kept this ticker — the swap isn't why it's on the
  board): n=62, WR 51.6%, avg P&L **+2.0%**. `GAIN_OVER_RANGE_EXCLUSIVE` (exists on the board only
  *because of* the ranking swap — the swap's own doing): n=9, WR 33.3%, avg P&L **−10.3%**.

Read with the same single-sample caution this repo applies to every other first-look A/B here
(n=9 on the exclusive cohort is thin, well under the script's own 15-play bar for that SPECIFIC
split even though the overall population clears it) — but the direction is consistent and not
small: the names gain_over_range adds that momentum would not have picked are underperforming the
shared cohort by a wide margin (18.3pp WR, 12.3pt avg P&L), which is exactly the failure shape the
original 2026-08-07 finding's own proxy measurement could not see (it graded underlying
continuation, not option P&L, spread, or contract-build failure). **No gate/ranking changed by
this update** — this is now real evidence where before there was only a blocked premise, but n=9
on the specific cohort that matters is not enough to act on unilaterally. Flagging for the
0DTE-owning lane to weigh alongside the rest of this file's evidence; re-run as the population
grows (`--since=2026-08-25 --json`, no flags needed — it re-derives the window from live data
every run) before treating either number as settled.

## E7 — "catch bangers like Swift" — operator mandate 2026-10-22, continuing/in-progress

**Context.** Operator directive after seeing a Discord #-swiftx recap (2026-10-21, 22-0 claimed,
`$XSP 776P +2140%`, `$SPY 771C +414.81%`, `$NVDA 220C +361.54%`, etc.): "Make catching setups
like these a priority... investigate, implement, test, and keep improving... Do not manufacture
bangers by loosening risk controls, cherry-picking winners, or using hindsight." This continues
the 2026-10-20 Swift-comparison work (`zerodte-swift-comparison.mjs`,
`docs/audit/history/swift-trades/`) on a SECOND, independent real session day — not a restart.

### Step 1 — transcribed + classified a second real session (2026-10-21)

`docs/audit/history/swift-trades/2026-10-21.json` — 21 of the stated 22 trades (the screenshot
shows a horizontal rule directly above its header suggesting one row was cropped off top; the
missing 22nd trade is NOT fabricated/guessed, flagged in the file's own `note`). No exact
alert/exit timestamps exist in this data source (same disclosed limitation as 2026-10-19) — the
existing script's price-match-window proxy is used instead of a guess.

Ran the existing `zerodte-swift-comparison.mjs` (no changes needed — same tool, second real day):

| Classification | n (18 0DTE trades, 3 out-of-scope non-0DTE excluded) |
|---|---|
| COMMITTED (NH traded the same ticker/direction, real timing at/before Swift's window) | 7 |
| GATE_REJECT (real candidate, rejected by a named gate) | 9 |
| DISCOVERY_MISS | 2 (both XSP) |

Matches the 2026-10-19 session's core conclusion on a second, independent day: **discovery and
timing are essentially never the problem** (DISCOVERY_MISS 0/13 then 2/18, and the 2 here are a
single root cause, see below). The mix of COMMITTED vs GATE_REJECT shifted (39%/50% here vs
15%/85% on 10-19) — both real, both legitimate, different days.

### Step 2 — XSP DISCOVERY_MISS run to ground: a real data absence, not a code gap

Checked (not guessed) whether XSP is excluded from Night Hawk's scan universe: it is NOT — no
ticker allowlist gates FLOW discovery, and XSP appears in the local flow-history archive on 3 of
5 recently-sampled days (10-14, 10-15, 10-16). Collected the previously-missing 2026-10-19/20/21
flow-history archives (`zerodte-history-collect.mjs --restart`, 71 real UW pages, 5180 new rows)
and checked 2026-10-21 directly: **UW emitted exactly ONE XSP alert all session — a 29-DTE,
$800-strike call, nothing resembling the 0DTE 776-strike Swift traded.** No 0DTE XSP flow signal
existed that day for any discovery pipeline to find. Closed, not actionable from this side.

### Step 3 — gate-rejection pattern: `min_dominance` and `score_floor`/`thesis_rank_reject` recur

Gate codes across the 9 GATE_REJECT trades (SPX ×6, AMD ×3): `min_dominance` appears on both
tickers (SPX 5-8x per cluster, AMD 2x); AMD's dominant codes are actually `score_floor`×9 and
`thesis_rank_reject`×9 (plus `max_itm_pct`×5), a different profile than SPX's min_dominance-heavy
one. `min_dominance` was already identified as the single highest-raw-count gate on 2026-10-19
(QQQ/SPX/SPY) and real-cost A/B tested then as **INCONCLUSIVE** (TRAIN confirmed the gate,
VALIDATION n=19 — one short of the n=20 trust bar — pointed the opposite direction;
`zerodte-min-dominance-real-cost-ab.mjs`, FINDINGS.md 2026-10-20). Re-ran that same script
(unmodified) with the newly-collected 10-20/10-21 archives in the window, `--days=24`:

| | TRAIN (n=40 PASS / 13 REJECT) | VALIDATION — held out (n=40 PASS / 13 REJECT) |
|---|---|---|
| PASS: win rate / net expectancy | 50.0% / +6.13% | 35.0% / -0.75% |
| REJECT_MIN_DOMINANCE: win rate / net expectancy | 23.1% / +0.97% | 15.4% / **-12.10%** |
| Verdict | INSUFFICIENT DATA (REJECT n=13 < 20) | INSUFFICIENT DATA (REJECT n=13 < 20) |

This was a real shift from the 2026-10-20 result (the TRAIN/VALIDATION *disagreement* that made
that run inconclusive was gone — REJECT graded worse than PASS in both halves) but REJECT's own
population (n=13/half) was still below the n=20 trust bar. Relaunched with
`--days=40 --max-per-half=60` to try to clear it on real additional history:

| | TRAIN (n=60 PASS / **23** REJECT) | VALIDATION — held out (n=60 PASS / **23** REJECT) |
|---|---|---|
| PASS: win rate / net expectancy | 33.3% / -7.30% | 38.3% / -2.19% |
| REJECT_MIN_DOMINANCE: win rate / net expectancy | 17.4% / **-4.98%** | 21.7% / -5.58% |
| Verdict | ⚠ REJECT graded BETTER than PASS net of real costs | gate correctly separating (REJECT worse) |

**Now properly powered (REJECT n=23 clears the n=20 bar in both halves) — and the two halves
DISAGREE again, this time with real statistical weight behind each side, not a thin-sample
artifact.** TRAIN says the gate is backwards (it rejected setups that would have graded better).
VALIDATION says the gate is correctly separating. Combined with the smaller `--days=24` run
above (which showed REJECT beating PASS in BOTH halves), the full picture across three
independent re-cuts of overlapping-but-different day windows is: **unstable, not just
"inconclusive for lack of data."** The verdict flips with which days are in the window, and the
`max_dd` figures are extreme in every cell (-576.67% to -125.72%) — a small number of outlier
trades plausibly dominate the net-expectancy averages. **Per the operator's own standing
instruction ("do not manufacture bangers by loosening risk controls... using hindsight"), this
does NOT clear the bar for touching `min_dominance` either direction.** No gate changed. The
honest next step on this specific gate is isolating and naming the outlier-driven trades before
trusting any aggregate number from this population, not re-running the same test a fourth time
with yet another day-window.

### Step 4 — contract-selection on COMMITTED trades: NOT a tunable "be more aggressive" knob

On the 7 COMMITTED trades (SPY×5, NVDA, AAPL), Night Hawk traded the SAME ticker/direction but a
materially different, less-leveraged strike (e.g. SPY 775C vs Swift's 771/772/773C; NVDA 217.5C
vs Swift's 220C) and closed for single-digit/teens % via the ratchet/trim_scale floor instead of
riding to 200-400%+. Traced WHY: `board.ts`'s FLOW-origin `top_strike` is the strike with the
MAXIMUM aggression-weighted real premium among the dominant side's own options-flow prints
(`board.ts` ~line 1264-1277) — it is literally "trade where the real institutional flow money
concentrated," not a deliberate conservative/ITM preference. Swift's strikes landed at DIFFERENT
levels than where the flow concentrated that day. This means "pick a cheaper/more-OTM strike" is
not a parameter to tune on the existing FLOW engine — it would require a genuinely separate
strategy (e.g. an always-ATM 0DTE lane independent of flow concentration), a materially bigger
build than a threshold change, and — per the operator's own "do not manufacture bangers" rule —
one that must be proven across many real days (most 0DTE ATM lottos expire near worthless) before
shipping, not inferred from these 7 winning examples. Also note: `SETUP_MAX_ITM_PCT=2`/
`RUNNER_SETUP_MAX_OTM_PCT` already bound the FLOW strike pick on BOTH sides (reject too-deep-ITM
AND too-far-OTM) — the engine already avoids the most boring, lowest-leverage contracts; it is
not unconstrained toward conservatism.

**CORRECTION / sharper finding (same investigation, a few hours later): an ATM selector for 0DTE
already EXISTS and already ships — this is not a build-from-scratch question.**
`pickAtmZeroDteContract` (`breakout-source.ts` ~line 234) is the REAL, live contract-selector for
BREAKOUT-origin setups: nearest expiry first, then strike CLOSEST TO SPOT net of a small
liquidity tie-break — genuinely ATM-seeking, unlike FLOW's "wherever the real premium
concentrated" pick. The open question is narrower than "build an ATM lane": **when a ticker
qualifies through BOTH FLOW and BREAKOUT on the SAME direction the same day, which origin's
contract wins?** Read `mergeSameTickerDiscovery`/`stampFlowEvidenceFromIncoming` (`board.ts`
~line 448-543) directly — confirmed in the code's OWN doc comments, not inferred: on a
same-direction merge, "**contract geometry stays with the kept setup**" and "seating order wins
ties (kept was seated first...)" — i.e. whichever origin seats first (FLOW, per the existing,
separately-documented FLOW-first-precedence design) keeps its OWN strike pick, and the other
origin's candidate contract (BREAKOUT's ATM pick, when BREAKOUT also flagged the same
ticker/direction) is discarded outright — only its score contributes a corroboration boost.
**This is the single most concrete, already-partially-built lead from this round.** Two real
unknowns, not yet answered: (1) did BREAKOUT actually ALSO flag SPY/NVDA/AAPL that day (unknown —
not checked this round; the committed rows show `origin=["FLOW"]` only, meaning either BREAKOUT
never flagged them, or it did and its origin label was never unioned in because of a timing/order
detail — needs a real historical check), and (2) if it did, would BREAKOUT's ATM pick have graded
better across many real days (not just these cherry-picked Swift winners) once real costs are
applied — NOT the already-existing `merge-precedence-ab.mjs` (that tool tests OPPOSING-direction
disagreement rows specifically, a different code branch than the same-direction case found here)
— a genuinely new, not-yet-built real-cost A/B is needed.

### Step 5 — consolidated the two Swift sessions into one verified, machine-readable dataset

`docs/audit/history/swift-trades/consolidated-verified.json` merges the 2026-10-19 (14 trades) and
2026-10-21 (21 trades) files into one 35-trade dataset, per-trade, with explicit structured
completeness flags rather than only prose notes: `is_0dte` (computed, not guessed, from
`expiry === session_date`), `missing_fields` (`alert_ts`/`entry_ts`/`exit_ts` — neither source
screenshot carries exact timestamps, a property of the source material disclosed per-trade here,
not an extraction gap), and `verified_fields` (the fields that ARE real/transcribed:
ticker/side/expiry/strike/entry_px/exit_px/pct/swift_marked). Totals tie out exactly against the
two source files (35 trades, 31 0DTE, 1 loss — the ambiguous SPX 7695C row).

**Explicit, disclosed limitation this step surfaces rather than papers over**: the operator asked
to "study all examples, including losses — not just the biggest winners," but this Swift-sourced
dataset is, by construction, almost entirely a winner population (2026-10-21 is 22-0 per the
channel's own stated record; 2026-10-19 has exactly one ambiguously-classified loss). Swift's
recap channel is a highlight feed — it structurally cannot supply a real losing-trade population.
The dataset's own `dataset_bias_disclosure` field says this plainly: the loss side of this study
has to come from Night Hawk's OWN real historical losing 0DTE commits, not from manufacturing or
assuming a loss shape out of Swift's winners. That cross-reference (pulling our own real closed
0DTE losers via `GET /api/market/zerodte/record` and reconstructing the same pre-entry signals for
them) is the natural next step before any pre-entry-signal reconstruction (Step 7 below) can honestly
claim to cover "including losses," not just winners.

### Step 6 — the BREAKOUT co-flag question (Step 4's open item) — answered: NO, and it's decisive

Ran the REAL `screenBreakoutMovers` (`src/features/nighthawk/lib/candidates.ts`) against REAL
Polygon grouped-daily bars for 2026-10-21 — the session the 7 COMMITTED trades (SPY×5, NVDA, AAPL)
came from — at a generous `maxKeep=5000` (not production's `top-40`) so a near-miss would still
show up as "qualifies but ranked low," not just "absent."

| Ticker | real o→c gain | real close_strength | BREAKOUT_MIN_GAIN (2%) | BREAKOUT_MIN_CLOSE_STRENGTH (0.5) | Cleared screen? |
|---|---|---|---|---|---|
| SPY | +0.25% | 0.776 | **FAIL** | pass | NO |
| NVDA | +0.46% | 0.951 | **FAIL** | pass | NO |
| AAPL | +1.36% | 0.804 | **FAIL** | pass | NO |
| AMD | +1.25% | 0.791 | **FAIL** | pass | NO |

**None of the four cleared the screen, and all four failed on the SAME single variable** — the
2% intraday gain floor — while comfortably passing close-strength (0.78–0.95, well above the 0.5
floor). This is not a close call: AAPL's 1.36% is the nearest of the four and still under half the
threshold. **This closes Step 4's open question as a real, decisive NO**: BREAKOUT never had a
candidate for SPY/NVDA/AAPL/AMD on 2026-10-21 to merge with FLOW's, so the
`mergeSameTickerDiscovery`/"contract geometry stays with the kept setup" mechanism never had an
opportunity to act on these specific trades — it is a dead end for THIS session's contract-pick
gap, not the explanation. (It may still matter on a different day where BREAKOUT *does* clear 2%
gain on a flow-corroborated ticker — that general question stays open; only this session's
specific trades are resolved.)

**This sharpens the diagnosis back to Step 4's ORIGINAL finding, not its correction**: Swift's own
strikes that day were within 0.01%–1.9% of the session's close (SPY 771/772/773 vs close 773.09;
NVDA 220 vs close 221.97; AAPL 337.5 vs close 343.99) — i.e. genuinely near-ATM/slightly-ITM picks
on underlyings that barely moved (sub-1.5% gain in 3 of 4 cases). The outsized option returns
(+193% to +415% on the SPY/NVDA calls) are 0DTE leverage/convexity doing the work on a small real
move, not a big underlying breakout — which is exactly why BREAKOUT (calibrated to find *big*
moves) was silent. Night Hawk's own committed contract on this cluster (SPY 775C, further from the
close than any of Swift's three SPY strikes) being less leveraged is therefore, as Step 4
originally found before the merge-mechanism correction, a direct consequence of FLOW's
`top_strike` picking "where the real premium concentrated" rather than "nearest to spot" — not a
contract-geometry-merge issue. No gate/selector changed by this step; it is a negative result on
the specific lead, reported honestly per the operator's own "report honestly if the evidence
doesn't support an improvement" instruction, not a reason to keep re-testing the same mechanism.

### Step 7 — reconstructed pre-entry signals on the COMMITTED cluster with the new shadow modules — a real, disclosed limitation, not a win

Task #7 of the mandate: "Reconstruct what was observable before each entry" using the new
shadow-only `momentum-acceleration.ts`/`relative-volume.ts`/`strike-reachability.ts` modules
(PR #6614). Ran this on the 7 COMMITTED-cluster trades (SPY×5, NVDA, AAPL, 2026-10-21) using ONLY
real Polygon minute bars strictly BEFORE each trade's option price-match window (no lookahead), a
30-minute opening-range as the key level, and a flat-proration RVOL read against each ticker's
real trailing-20-day average volume.

**First, an honest methodology check that mattered**: of the 7 trades, only 2 (SPY 771C, NVDA
220C) have exactly ONE price-match window for the session — the other 5 have 3–6 candidate
windows spanning most of the trading day (e.g. SPY 773C @ $0.56 matches 6 separate times, from
09:32 to 16:14 ET). A cheap 0DTE option's premium revisits the same price repeatedly across a
session, so "the first (or last) window" is NOT a reliable single-point entry-time proxy for
those 5 — reporting a pre-entry signal reconstruction from an arbitrarily-chosen window among 3–6
real candidates would be false precision, not evidence. Only the 2 unambiguous trades are reported
below; the other 5 are a genuine data-availability ceiling (exact timestamps don't exist in the
source, as already disclosed in `consolidated-verified.json`), not something this step can resolve.

| Trade | Pre-entry momentum read | RVOL | What really happened (real bars) |
|---|---|---|---|
| SPY 771C @ $0.68 (window 10:09 ET) | `accelerating:false, confirmed:false` (flat/no signal) | 1.09 (normal) | momentum-discovery would NOT have detected a setup here — consistent with a quiet moment, not a miss. |
| NVDA 220C @ $0.46 (window 10:11–10:30 ET) | `direction:"down", accelerating:true, confirmed:true` | 1.84 (high) | Real minute bars show NVDA genuinely bottomed near $218.0–218.3 in this exact window (strike was $220, so OTM) after opening at $220.96 — a real intraday DIP, not a continuation. NVDA went on to rally hard later that session (Swift's exit premium $2.10, +361.54%, per the Swift recap). |

**The NVDA read is the important, honestly-reported result, not a success.** The new
`momentum-acceleration.ts` module is deliberately built to detect CONTINUATION (an accelerating
move confirmed by a same-direction key-level break) — by design it is structurally incapable of
flagging a contrarian dip-buy as a long setup, and it didn't: it correctly read the real, genuine
down-move in progress at that moment and reported `direction:"down"`. If `momentum-discovery.ts`'s
`detected`/`direction` output were (hypothetically) used as a hard long/short signal at that exact
timestamp, it would have pointed to a PUT, the opposite of Swift's profitable call. **This is not
a bug in the new modules — it is a real, now-evidenced boundary on what a continuation-style
momentum signal can ever explain**: at least one of Swift's two cleanly-reconstructable winners was
a contrarian/mean-reversion entry, a different trade shape entirely from "catch the breakout
early." Per the operator's own "report honestly if the evidence doesn't support an improvement"
instruction, this is logged as exactly that — a real limitation, not downplayed or explained away.
No code changed by this step. The implication for Task #3/#4: any real-cost validation of the new
discovery path should expect it to catch continuation-shaped setups (if any exist in Swift's
population) and should NOT be judged a failure for missing contrarian/dip-buy setups like this
NVDA trade — those need a structurally different signal (e.g. a mean-reversion/exhaustion read),
which is out of scope for what was built this round and not fabricated here to cover this gap.

### Step 8 — the real-cost A/B for an ATM-biased FLOW selector: genuinely unstable, same shape as `min_dominance`

Step 6's sharpened hypothesis (FLOW's `top_strike` premium-concentration pick, not a merge-
precedence question, is the real locus of the contract-leverage gap) is now tested directly, not
just argued. Built `scripts/audit/zerodte-flow-atm-selector-real-cost-ab.mjs` (+
`lib/flow-atm-selector-eval.mjs`, 11 unit tests): pulls the REAL FLOW-origin committed population
via `GET /api/admin/zerodte/tier-export`, and for each row grades BOTH the real traded contract
(`top_strike`, real recorded `entry_premium`) AND a counterfactual nearest-to-spot ("ATM") contract
through the IDENTICAL real `evaluateExitState`/`TRIM_SCALE_RULES`/`resolveExitModeForTier` exit
engine, same real time-stop, same regime. Paired design (same commit instant, two strikes), same
statistical discipline as `swing-early-trim-ab.mjs`'s `comparePolicies()` — mean paired delta with a
normal-approx 95% CI, chronological TRAIN/VALIDATION split.

**Disclosed approximation** (can't be avoided, not papered over): the ATM counterfactual strike is
picked by pure distance-to-spot from the real listed-strike universe — it does NOT reproduce
`pickAtmZeroDteContract`'s full liquidity-quality scoring (spread + OI), which needs a real
NBBO+OI snapshot for every listed strike at the exact historical commit instant, unavailable
offline. Its entry premium is therefore the real contract's own first traded bar's open at/after
the commit timestamp (a real print), not a recorded fill — asymmetric with the actual side's real
recorded `entry_premium`, disclosed rather than smoothed over.

**First live run, 90-day window (the tool's own max), 144 FLOW-origin rows, ALL 144 paired-graded
(zero drops in any category — actual-bars/spot/chain/ATM-bars all resolved cleanly), 37/144 (25.7%)
where the ATM pick happened to equal the real `top_strike`:**

| | TRAIN (n=72) | VALIDATION (n=72) |
|---|---|---|
| win rate: actual / ATM | 30.6% / 41.7% | 38.9% / 40.3% |
| mean P&L: actual / ATM | -16.38% / -11.61% | -4.37% / -5.68% |
| mean paired delta (ATM − actual) | +4.78pp [-4.81, 14.37] | -1.31pp [-12.45, 9.83] |
| verdict | INCONCLUSIVE | INCONCLUSIVE |

**Same shape as the `min_dominance` result (Step 3), not a coincidence worth ignoring**: both CIs
straddle zero, AND the two halves disagree on sign (TRAIN leans ATM, VALIDATION leans actual) —
genuinely unstable, not merely under-powered (n=72/half is a real, reasonably-powered sample by
this file's own n≥20 convention). One consistent thread across both halves worth naming, not
over-reading: ATM's win RATE is higher in both (41.7% vs 30.6%; 40.3% vs 38.9%) even though the
P&L sign flips — a higher hit rate on smaller average moves is a different trade shape than a lower
hit rate with occasional large winners, not necessarily a better one net of variance, and this
script does not have the power to separate those explanations. **Per the operator's own "do not
manufacture bangers by loosening risk controls... or using hindsight" instruction, this does NOT
clear the bar to touch `top_strike`'s premium-concentration selection.** No gate/selector changed.
The win-rate thread (ATM consistently higher hit rate) is the one loose end worth a future look —
with a larger population once more FLOW-origin history accumulates, not from re-running the same
90-day window again.

### Status / next checkpoint

**Not solved — six real results this round, none of them a ship:**
1. `min_dominance` real-cost A/B, run THREE times now at increasing statistical power
   (n=19/13/23 REJECT per half across the runs) — genuinely **UNSTABLE across day-windows**, not
   just under-powered. Per the operator's own "do not manufacture bangers... using hindsight"
   rule, this does not clear the bar to touch the gate. Next step on this thread specifically:
   isolate the outlier trades driving the extreme `max_dd` figures before trusting any more
   aggregate runs of the same test.
2. AMD's `score_floor`/`thesis_rank_reject`/`max_itm_pct` cluster not yet investigated this
   round — connects to the SEPARATE, already-documented `score_floor` INVERTED finding (E6
   below, 28 real sessions, 2026-09-17) and is a candidate for the SAME kind of real-cost re-test
   just run on `min_dominance`.
3. **CLOSED, negative result (Step 6 above): the FLOW-vs-BREAKOUT same-direction contract-geometry
   merge mechanism is a dead end for the 2026-10-21 COMMITTED trades** — BREAKOUT never co-flagged
   SPY/NVDA/AAPL/AMD that day (all four failed the 2% gain floor cleanly; close-strength was never
   the limiting factor). The real locus of the contract-leverage gap on this cluster is FLOW's own
   `top_strike` premium-concentration pick (Step 4's original finding), not a merge-precedence
   question. The genuinely ATM-biased FLOW-origin selector this pointed to WAS built and
   real-cost/out-of-sample tested — see item 5 below (Step 8): also inconclusive, same shape as
   `min_dominance`.
4. **Step 7 above — the new shadow momentum-discovery modules cannot, by design, catch a
   contrarian/dip-buy entry** (the NVDA 220C reconstruction). Only 2 of the 7 COMMITTED-cluster
   trades had an unambiguous price-match window at all; of those, one showed a flat/no-signal
   read (SPY 771C) and the other showed the module correctly reading a real down-move that was
   actually a dip Swift bought before a later reversal (NVDA 220C). A real, disclosed boundary on
   what this signal family can explain — not fixed this round, and not something to paper over
   when Task #3/#4's real-cost validation runs.
5. **Step 8 above — the ATM-biased FLOW selector real-cost A/B is INCONCLUSIVE and genuinely
   UNSTABLE, same shape as `min_dominance`** (144 FLOW-origin rows, 90-day window, n=72/half — both
   CIs straddle zero AND the two halves disagree on sign). Per the same "do not manufacture
   bangers... using hindsight" discipline, `top_strike`'s premium-concentration selection is NOT
   touched on this evidence. One loose thread worth a future look, not acted on now: ATM's win rate
   was higher in BOTH halves even though the P&L sign flipped — needs a larger population before
   it means anything, not a re-run of the same window.

Checkpoints continue in `docs/audit/nighthawk-0dte-live-journal.json` across the standing Night
Hawk 0DTE trigger cadence — this is a multi-session research program, not a single-turn task.

## Edge cases / scenarios still to simulate
VIX-regime buckets; trend-day vs range-day; fade-the-open vs follow; gamma-regime (trade toward the
flip / avoid pinned-to-wall); exit-engine replication vs hold-to-close; SPX/NDX index 0DTE; whole-market
banger with a realistic scale-out exit rule (quantify realized vs maxRet); news/catalyst-day conditioning;
half-days / OPEX / triple-witching; bid-ask slippage realism at entry.
