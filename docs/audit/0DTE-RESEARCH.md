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
   windows that disagree.

**The banger scale-out is the flagship, and it's the positive-skew spine both engines share.** Validated
at scale (minute-bar realistic gap-fills, **7,086 movers / 500 sessions / 2 years / all sectors**):
**+26% gross / ~+20% net-OOS** realized under the mechanical scale-out (0.5@2×, trail runner at 50% of
peak, hard stop 0.4×) — vs hold-to-expiry ~1.0× (decays to zero). That is the durable edge: buy cheap
positive-skew optionality, then *exit mechanically into the spike*. It ships **calibration-first** as a
pure core (`banger-scale-out-grade.ts`) pinned into `entry_context.scale_out`; the ledger's
`recommendScaleOut` (EV-mult delta ≥ 0.15, ENFORCE_MIN_BLOCK_N=10) graduates it before it manages a live
exit — same discipline as every other signal.

**Rearchitecture synthesis (task #21):** the "strongest 0DTE engine" is not one clever entry — it's a
**two-engine, positive-skew, scale-out-spined** system with a **calibration-first graduation ladder**:
- **Engine A (index 0DTE grinder):** SPY/QQQ/IWM/SPX — the only true same-day-expiry names. Confluence
  tier (E3, +16% EV) takes fewer triple-confirmed trades; let-it-run geometry; the ratchet finding above
  is the next exit tune.
- **Engine B (whole-market weekly banger):** all sectors, cheap OTM weeklies, the +20% net-OOS
  scale-out. Finding movers is trivial; the exit is the whole edge.
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
