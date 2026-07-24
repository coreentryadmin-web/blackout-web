# 0DTE Unification — Design of Record (one board, whole-market, stronger)

**Date:** 2026-07-24. **Author:** audit synthesis (3 independent code audits + 45d live calibration
+ today's graded counterfactual + fresh condor backtest). **Goal:** collapse the two 0DTE engines into
ONE live intraday product that scans the whole market, never prints a measured-losing setup, and manages
winners for EV — not a coin-flip that scratches its own winners.

This supersedes the "two-engine parallel" state. **Legacy stays as its own thing** (post-close, next-day
1–5 play digest — NOT 0DTE, untouched by this).

---

## 0. The two systems today — what's good, what's not

### System ① — the LIVE intraday flow board (`scanZeroDteBoard`, `src/lib/zerodte/*`)
**Keep (production spine — genuinely good, preserve verbatim):**
- Fail-closed **hard-gate stack** ordered cheap→precise (G-1 tape-align, G-2 10:00 unlock, G-3 score floor, G-8/9 no-chase/no-illiquid/no-fabricated-plan, G-5 context-unavailable → fail closed).
- **Cortex** evidence model: signed/bounded/timestamped evidence, per-source support caps with *unbounded veto asymmetry* (one loud bearish fact kills an entry; no single bullish signal can buy one), half-life decay, honest ABSENT stance, fully replayable from a snapshot.
- **Governor**: ledger-derived (replica-safe) concurrency cap, 3-stop session halt, correlated-conflict block, re-entry lock.
- **Graded ledger**: every commit graded two ways (option-bar plan outcome + underlying direction), breakeven a distinct state. Discovery record is *measured, not asserted*.
- **Exit engine**: pure, replayable, freshest-mark-wins, never-exit-on-missing-data, unconditional thesis-break exit.
- **One-way commit door**: a transient DB blip can't demote a committed OPEN back to a watch card.

**Fix (what's not good):**
- **Discovery is flow-only, top-400-by-premium** — the structural blind spot. A clean price/VWAP/breadth momentum move or a whole-market breakout with no whale option print is *invisible*. On mega-cap-heavy days the top-400 saturates with indices+mega-caps and starves smaller high-quality setups.
- **Momentum-only by construction** — G-1 hard-blocks every counter-tape direction; nothing admits a mean-reversion / pin-fade (which is the *correct* 0DTE trade in a long-gamma range). The board empties or whipsaws in range regimes.
- **Fail-OPEN holes exactly when volatility is highest** — Cortex ABSTAIN under provider stress removes the two veto protections (dealer-wall-in-path, $1M-whale-opposing); G-4 (VIX) and G-7 (macro) degrade a timed-out read to *no block*. The protections vanish on the days they matter most.
- **Score isn't a clean EV rank** — ~80% of score is "big + one-sided + many prints"; a roll/close/hedge stack scores ≥65 with unverified intent. Aggression proxy fails open on missing `ask_pct`. No far-OTM cap (lotto stacks pass). **Live proof: score band 75–84 = 22% WR/−15% while 65–74 = 48%/+11% — non-monotonic.**
- G-11 halt/earnings only reliably applies to the top-5 enriched ranks (6–10 default `halted:false`/`earnings:null`).

### System ② — the MATURE deterministic engine (`buildDeterministicEditionPlays`, `candidates.ts`)
**Lift (the durable edge):**
- **Whole-market discovery at zero marginal cost** — `screenBreakoutMovers` rides the grouped-daily summary already fetched (~12.4k names, gain×volume×close-strength). Plus 6-lane multi-source corroboration.
- **Iron-condor geometry** — the backtested high-WR premium-selling counterpart (fresh: ±0.8%→93.3%, shipped target-80→98.7% close WR / 13.3% intraday breach). Honestly negative-skew, WR display-capped at 97 + breach companion.
- **Scale-out exit** — the most-validated edge in the repo (+19–20% net OOS over 7,086 movers / 500 sessions).
- **Calibration-first graduation ladder** — nothing enforces/sizes until its bucket clears n≥10 + WR-delta≥15pts. This is the anti-overfit spine and it governs everything below.

**Don't lift (cadence artifacts — would mislead live):**
- Weekly-DTE default contracts (`MIN_DTE_CALENDAR_DAYS=5`); publishes at **score 35** (fail-open vs live 65).
- No live gate stack, no `buildContractPlan` marks/spread/chase check, no Cortex, no governor.
- Reads grouped-daily "today" — intraday that bar is incomplete → breakout lane silently degrades.
- Fail-open contract relax ladder + `buildRescuePlays` publishes illiquid/stock-only with a caveat, never blocks.

**Verdict:** lift ②'s **discovery + calibrated exits ON TOP of ①'s spine.** Not the other way around.

---

## 1. The unified architecture (one board)

`scanZeroDteBoard` stays the shell (keeps the whole spine). Three changes to what flows through it:

### 1a. Discovery = THREE INDEPENDENT sources, each stamping a first-class origin (NOT a collapsed pool)

The sources run **independently** and each emits its own candidate carrying a single origin. They are never
merged into one undifferentiated discovery pool — that would destroy the per-source research capability. The
merge step unions **by ticker** but **preserves the origin as a set**, so a name found by two sources carries
both origins.

1. **FLOW discovery** → Candidate(origin=`FLOW`) — existing top-400 0-1DTE whale option prints (`fetchRecentFlows` → `deriveZeroDteSetups`). The whale-intent feed.
2. **BREAKOUT discovery** → Candidate(origin=`BREAKOUT`) — whole-market price/volume/close-strength screen (lift `screenBreakoutMovers`) that makes no-whale momentum visible. *Adaptation:* intraday it must read a live minute-aggregate snapshot, NOT grouped-daily-today (incomplete mid-session). Off-hours/first-print empty = SKIP, not fail.
3. **PIN discovery** → Candidate(origin=`PIN`) — mean-reversion: names pinned between dealer-defended GEX walls in a long-gamma tape (the range/fade setup the current momentum-only board structurally rejects). This is *also* the discovery source that feeds the iron-condor play-type (§1c).

**Origin provenance (persisted, calibration-sliceable).** Each committed setup carries a `discovery_origin`
SET stamped at merge time — one of `FLOW`, `BREAKOUT`, `PIN`, `FLOW+BREAKOUT`, `FLOW+PIN`, `BREAKOUT+PIN`,
`ALL_THREE`. It is persisted on the ledger row AND the feature vector, and the calibration report gains an
**origin-band** section (exactly like the existing `confluence_tiers` / `accumulation_alignment` bands) so
the graded ledger can answer, per origin, on real outcomes:
- Does `FLOW+BREAKOUT` outperform `FLOW` alone?
- Are `PIN`-only setups profitable (and in which regime)?
- Is `ALL_THREE` confluence worth a score boost — and how much?

Each source stays **independently tunable and independently graduatable** through the n≥10 / delta≥15 ladder —
a weak source can be throttled or dropped without touching the others, and a multi-origin corroboration boost
is only applied once its origin band earns it on graded evidence (never hand-set).

Every candidate — regardless of origin — then runs through the **same** contract-attach (§1b), gate stack,
Cortex, and governor. The multi-day accumulation read (`attachFlowAccumulation`) is kept as a **cross-cutting
direction/confirmation overlay** on every candidate (not a 4th origin): *live proof it matters:* today the flow
board took **MU long → −50%** while multi-day accumulation was **MU bearish → +100%** — the direction check the
board currently throws away at commit time.

### 1b. Contract attach is MANDATORY and gated
Every candidate goes through `buildContractPlan` (0DTE, weekly fallback) → `plan_illiquid`/`plan_moved`/`plan_no_quote` are hard blocks. This closes ②'s fail-open contract hole: a cheap breakout with no liquid same-day contract is **dropped**, not shipped with a caveat. (This is also why the condor + index names matter — they're the liquid, tradeable core.)

### 1c. Two play types, routed by regime (calibration-first — the one genuinely untested piece)
- **Directional (long premium):** short-gamma / trending tape / fading-opposing-wall + **≥2 confluence** → buy the move on let-it-run −50/+100 geometry.
- **Iron-condor (sell premium):** long-gamma / range / dealer-defended walls / low VIX → sell defined-risk beyond the GEX walls, credit priced off the live chain, breach-stopped, small size.
- **Router signals** (all already persisted): gamma regime (spot vs flip), VIX band, wall geometry (`wallPathCheck` + bead-trend fade/build).
- **Honest gap:** the *conditional* routing ("route by regime beats one-engine-everywhere") is asserted from the gamma mechanism but **not yet graded**. So the router ships as evidence-only and must graduate on the counterfactual ledger before it gates. This is the first new experiment, not a day-1 gate.

This is also the fix for "momentum-only": the condor path *is* the mean-reversion/range trade the current board structurally rejects.

---

## 2. The negative-play firewall — "never let a loser in" (fail-CLOSED, evidence-ranked)

Every measured-losing bucket the repo has, mapped to the fail-closed layer that removes it. Each layer graduates on the graded ledger (with SKIP-grading, so an over-tight gate's opportunity cost is *visible*, never a silent empty board).

| Layer | Rule | Removes (measured loser) | Evidence |
|---|---|---|---|
| 0 | Liquidity/structural + **mandatory plan-quality** (spread≤15%, no-chase, no-fabricated) | untradeable/illiquid contracts | shipped `board.ts`/G-8/9 |
| 0+ | **Aggression evidence floor** (require known-`ask_pct` fraction; kill the 0.5 fail-open) | roll/close/hedge stacks masquerading as conviction | Audit §2.2; PR #1028 |
| 0+ | **Far-OTM moneyness cap** (add an upper OTM bound) | negative-EV far-OTM lotto stacks | Audit §4-#4 |
| 1 | **Score floor 65** | score 55–64 → 18.8% WR / −24.5% | F-2 (n=16) |
| 2 | **Confluence ≥2 as a GATE, not additive score** (highest-EV lever) | 0-conf −12.5% EV, 1-conf 0% | E3 (n=4/49/22); 2-conf → **+15.9%** |
| 3 | **Tape-alignment (G-1)** | counter-tape longs 0/5, −54.7% | F-3 |
| 4 | **Entry window ≥10:00 ET** | 9:45 → −12.1%/26% WR | E2 |
| 5 | **VIX throttle (G-4) — now FAIL-CLOSED on a missing read for fresh commits** | VIX 17–20 → 25% WR; and the fail-open leak | F-1 (low-n) + Audit §4-#5 |
| 6 | **Governor** (3 concurrent / 3-stop halt / correlated-conflict / re-entry lock) | trend-day blast radius (7 stops uncapped) | §2 governor |
| 7 | **Cortex vetoes — abstain must NOT drop the veto sources** | dealer-wall-in-path, $1M opposing cluster | Audit §4-#1 (the top leak) |

**The two firewall *fixes* that matter most (both are current fail-open leaks that flip open exactly on volatile days):**
1. **Cortex veto-source protection.** Today a provider-stress ABSTAIN commits on gates alone — losing the gex-walls + flow-quality vetoes. Fix: for a **fresh** commit, if the two *veto-capable* sources specifically failed to read, treat it as HOLD (fail-closed on the protections; a watch card, not a commit). Non-veto source gaps still ABSTAIN as today.
2. **G-4 VIX / G-7 macro fail-closed for fresh commits.** A timed-out VIX or macro-calendar read must **block a fresh commit**, not pass it. (Live management of existing plays still degrades gracefully — capital protection can't depend on freshness — but *opening new risk* on an unreadable vol/macro state is exactly what fail-closed is for.)

Net effect on "board goes empty vs admit a loser": the confluence-2 gate (Layer 2) is the sharp one; it ships **calibration-first** with SKIP-grading so we *measure* whether tightening removes more −EV than it forgoes in +EV before it hard-gates. Never hand-tighten to empty the board on a hunch.

---

## 3. Deliver winners — the EV engine

1. **Trade management is leak #1, not discovery.** Today's graded counterfactual: 10 plays, raw avg **+22.8%**, 4 doublers; the shipped **+25% breakeven ratchet crushed it to +4.1%** by scratching winners at breakeven. 70% of plays reached +50%, 50% reached +100% — the green is *there*, the exit gives it back.
   → **Replace the breakeven ratchet with partial-trim `⅓@+25% / ⅓@+50% / run the last ⅓`** (0DTE). E5: dominates HOLD and the shipped floor in *every* split, WR 32%→50% (n=352). **Do NOT tight-trail a same-day 0DTE runner** (intraminute chop stops you before the move completes — `scale-out.ts` HORIZON NOTE). Ship behind `ZERODTE_EXIT_MODE`, graduate the flip on a live counterfactual `recommendExit` ledger (OOS windows disagree on exact thresholds; the *direction* trim>floor is robust, the numbers aren't settled).
2. **Confluence-2 is the only measured +EV directional bucket (+15.9%).** Fewer, triple-confirmed trades on let-it-run geometry. (Layer 2 above.)
3. **Whole-market banger scale-out** (+19–20% net OOS) — currently advisory-only because bangers never reach the live ledger. Unifying discovery (§1a) *fills its graduation ladder*; it flips to enforced automatically at n≥10.
4. **Condor is the high-WR sell-side engine** — routed by regime (§1c), credit-priced, breach-stopped, small size, WR capped at 97 (negative skew: profitability needs the credit + breach stop, not just WR).
5. **Horizon-specific management (don't conflate):** 0DTE = trim⅓@+25/+50/run (no trail); banger/weekly = 0.5@2× + trail@50%-of-peak + −60% stop; keep thesis-break (unconditional, any P&L) + flat-timeout (25min in ±10%).

---

## 4. Build plan (phased; each a small PR, flag-gated, calibration-first)

**Phase 0 — Firewall / fail-closed fixes (pure risk-reduction, ship first, no strategy change):**
- Cortex veto-source protection (abstain ≠ drop vetoes) · G-4/G-7 fail-closed on fresh commit · far-OTM cap · aggression evidence floor (adopt #1028) · enrich halt/earnings for all committable ranks · fix the stale "fail closed" comments to match code.

**Phase 1 — Confluence-2 commit gate** (calibration-first; resurrect #1065's G-12, default MIN=1 graduating to 2 on evidence). The #1 EV lever, and the direct fix for the 75–84 score inversion.

**Phase 2 — Trade management:** partial-trim exit behind `ZERODTE_EXIT_MODE`, graduate on the counterfactual ledger (adopt #1068). The #1 EV leak.

**Phase 3 — Discovery unification (three INDEPENDENT origin-tagged sources):** add BREAKOUT and PIN discovery alongside the existing FLOW source into `scanZeroDteBoard`, each stamping a first-class `discovery_origin` (§1a) preserved as a SET through merge — never a collapsed pool. Persist origin on the ledger row + feature vector; add the calibration origin-band. Every candidate through mandatory `buildContractPlan` + full gate stack + Cortex; multi-day accumulation stays a cross-cutting direction overlay. Flag `ZERODTE_WHOLE_MARKET` (and a per-source flag each, so a source can be enabled/throttled independently). Widen the funnel, un-starve the board, fill the banger scale-out ladder — and make every future "does source X pay?" question answerable on graded evidence.

**Phase 4 — Condor as a live second play-type**, regime-routed (calibration-first, small size, breach stop).

**Phase 5 — Grade the regime router** (the one untested claim): build the "route-by-regime vs one-engine-everywhere" experiment; gate only after it graduates.

Every phase: `tsc` + tests + `sim:0dte` before/after funnel, ships behind a flag, graduates through the n≥10 / delta≥15 ladder before it gates or sizes real money. The measurement loop — not any single parameter — is the moat.
