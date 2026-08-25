# Thesis-First Pipeline — Design of Record

**Date:** 2026-08-25  
**Status:** PROPOSED (supersedes option-first discovery in `0DTE-UNIFICATION-DESIGN.md` §1a over time)  
**Prerequisite:** Deploy tactical recall-quality fixes (PR #2894 — G-3/G-17 floors, FLOW corroboration) before Phase 2 refactor.

**Operator priority path (2026-08-25):** Ship **six rails first** (FLOW, MOMENTUM, BREAKOUT, REVERSAL, RS, POSITIONING), then the **cross-DTE Contract Engine** immediately — that pair is the foundation. CATALYST + VOL + regime v1 + UI follow.

---

## 0. The architectural decision (the single biggest redesign)

**Old architecture:**
```
Find 0DTE candidates → attach contracts → gate them
```

**New architecture:**
```
Find exceptional underlying opportunities first
  → independently establish thesis (multi-rail)
  → determine ideal holding horizon
  → select the best option expression (Contract Engine)
  → continuously manage thesis integrity
```

**Find the trade first. Find the option second.**

Today's engine asks: *"Can I find a 0DTE option on this ticker?"*  
The target engine asks:

1. **Is there a high-quality opportunity in NVDA?** (thesis — DTE-agnostic)
2. **What is the optimal expression of that thesis?** (contract + horizon + exit)

That gives you **0DTE when 0DTE makes sense**, 3DTE when 3DTE makes sense, 14DTE when the market expresses a slower thesis — and sometimes **NO TRADE**. That is how an options desk thinks.

Expression may be 0DTE, 1DTE, 3DTE, 7DTE, 14DTE, weekly banger (Engine B), swing tactical, iron condor, or **no options trade at all**.

---

## 1. Target pipeline (one board, thesis spine)

```
REGIME ENGINE
    ↓
DISCOVERY (6 core rails — DTE-agnostic, parallel)
    FLOW │ MOMENTUM │ RS │ BREAKOUT │ REVERSAL │ POSITIONING
    (+ CATALYST │ VOL — phase 2)
    ↓
MERGE BY TICKER → rail_scores panel + archetype classifier
    ↓
ARCHETYPE SCORE + ARCHETYPE GATES (per-archetype models — NOT one generic formula)
    ↓
CORTEX JUDGE (post-discovery — COMMIT / WATCH / REJECT)
    ↓
CONTRACT ENGINE (cross-DTE scan — pick best expression, separate module)
    ↓
RANK + GOVERNOR → ledger + continuous thesis-integrity management
```

**What stays:** fail-closed spine, governor, exit engines, graded ledger, calibration-first graduation.  
**What changes:**
- Discovery emits thesis (no strike/expiry)
- **Cortex becomes judge, not discoverer** — runs on `Candidate`, not the tape
- **Contract Engine is a separate module** — scans expiries, ranks contracts, picks optimal expression
- **Each archetype has its own scoring model AND gates**

---

## 2. Regime engine (run first, every scan)

Before Night Hawk hunts trades, classify **what kind of market exists**.

### 2a. Inputs (already partially available)

| Signal | Source today | Gap |
|--------|--------------|-----|
| SPY/QQQ/SPX trend | `regime.ts` structure (TREND_UP/DOWN/RANGE/INSIDE) | Index-level only; no breadth |
| Gamma posture | Per-name `gamma_regime` on dossier; SPX GEX matrix | Not aggregated to session regime class |
| Volatility | `regime.ts` vol bands from VIX | No vol *expansion/compression* (rate of change) |
| Breadth | — | **Missing** (advance/decline, % above VWAP) |
| Flow bias | UW net flow / market tide cache | Not in regime classifier |
| Liquidity | Spread/chain quality implicit in gates | Not session-level |
| Macro | `regime.ts` calendar + G-7 macro gate | Catalyst vs normal not a first-class regime axis |

Existing modules:
- `src/lib/zerodte/regime.ts` — structure/gap/vol/calendar labels
- `src/lib/zerodte/market-state-engine.ts` — v0 rail weights (FLOW/BREAKOUT/PIN only)
- `src/lib/zerodte/regime-plane.ts` — fail-closed commit confidence (not discovery weighting)

### 2b. Target regime taxonomy

Classify session into one primary playbook (multi-tag allowed):

| Regime | Character | Rail weights (example) |
|--------|-----------|------------------------|
| 🔥 **TREND EXPANSION** | Trending + short gamma + vol expanding | RS ↑↑, MOMENTUM ↑, BREAKOUT (COILED→trigger) ↑, FLOW ↑, REVERSAL ↓, POSITIONING.PIN ↓↓ |
| 🧲 **PIN / MEAN REVERSION** | Positive gamma + compressed tape | POSITIONING.PIN ↑↑, REVERSAL ↑, RS fade ↑, BREAKOUT ↓, MOMENTUM ↓ |
| ⚔️ **HIGH-VOL TWO-WAY** | Elevated VIX + wide range + mixed flow | FLOW ↑ (campaigns), REVERSAL ↑, POSITIONING.WALL_REJECTION ↑, BREAKOUT ↔ |
| 💤 **COMPRESSION** | Low vol + inside day + weak breadth | COILED setups ↑; commit only on trigger break; MOMENTUM/RS watch-list bias |

Regime output:
```ts
type SessionRegime = {
  primary: "TREND_EXPANSION" | "PIN_REVERSION" | "HIGH_VOL_TWO_WAY" | "COMPRESSION";
  axes: { trend, gamma, vol, breadth, flow, liquidity, macro };
  confidence: number; // 0–1 — low → equal rail weights (today's behavior)
  rail_weights: Record<DiscoveryOrigin, number>;
  play_type_prior: "directional" | "condor" | "mixed";
};
```

Extend `market-state-engine.ts` — do **not** replace the fail-closed `regime-plane.ts`.

---

## 3. Discovery engines (DTE-agnostic thesis emitters)

Each engine emits `ThesisCandidate`:

```ts
type ThesisCandidate = {
  ticker: string;
  direction: "long" | "short";
  discovery_origin: DiscoveryOrigin[]; // after merge
  thesis_score: number; // 0–100, pre-expression
  evidence: ThesisEvidence[]; // structured, replayable
  regime_at_discovery: SessionRegime["primary"];
  flow_class?: "EVENT" | "CAMPAIGN" | null;
  structural_state?: "COILED" | "TRIGGERED" | "EXTENDED" | null; // BREAKOUT rail
  structural_triggers?: StructuralTrigger[];
  momentum_read?: MomentumRead;
  relative_alpha?: RelativeStrengthRead; // RS rail
  positioning_archetype?: PositioningArchetype | null; // POSITIONING rail
  catalyst_bundle?: CatalystRead | null; // CATALYST rail
  reversal_read?: ReversalRead | null; // REVERSAL rail
  vol_read?: VolatilityRead | null; // VOL rail — primarily expression, not direction
  /** Per-rail 0–100 scores after merge — each engine scored independently. */
  rail_scores?: Partial<Record<DiscoveryOrigin, number>>;
  trade_archetype?: TradeArchetype | null;
  // NO strike, expiry, or plan until expression
};
```

### 3a. FLOW rail (keep, upgrade)

**Today:** Top-N by gross premium; gates = $200k gross, 30% aggression, 55% dominance; `computeFlowQuality()` logged but secondary.

**Target:** Campaign-aware institutional read.

Signals (many already in `flow-quality.ts`):
- Gross + net directional premium
- Ask/bid aggression, repeated fills, ascending size
- Same-strike / multi-strike / expiry concentration
- DTE distribution on the tape (informs expression, not admission)
- Volume/OI, opening likelihood, sweep/block mix
- Persistence, acceleration (`FlowMomentum.accelerating`)

**EVENT vs CAMPAIGN classifier** (new):
- **EVENT:** single print or <N minutes span, low persistence score
- **CAMPAIGN:** sustained accumulation (persistence + concentration + acceleration), multi-expiry optional

Campaigns score higher at thesis time; events require corroboration from MOMENTUM/BREAKOUT.

Example card copy:
> 🐋 NVDA — $12.8M directional calls · 74% ask-side · 31 prints · 3 expirations · accelerating 42m · **CAMPAIGN**

Files: extend `flow-quality.ts`, `board.ts` aggregation; remove `max_dte: 1` at fetch time (use full tape, classify DTE in evidence).

### 3b. MOMENTUM rail (absolute tape dynamics — not RS)

**Today:** Folded into BREAKOUT via `screenBreakoutMovers`. Intraday VWAP/OR/5m trend attaches **after** discovery in `intraday.ts`.

**Target:** Hunt names moving with *internal* strength before/alongside structural breaks.

Signals (absolute, ticker-local):
- Relative volume vs 20d (`rel_vol` on dossier)
- Rate of change, volume acceleration
- VWAP trend + minutes held above/below
- Higher highs / higher lows (intraday structure)
- EMA stack (9/21), ADX/trend strength
- Intraday persistence

**Not RS:** "Is NVDA going up?" lives here. "Is NVDA outperforming SOXX?" lives in §3c.

Example:
> AMD — RVOL 2.4×, holding VWAP 90m, HH/HL intact, not at PDH yet

Files: `momentum-source.ts`, `momentum-discovery.ts` · reuse `intraday.ts`, dossier `rel_vol`.

### 3c. RELATIVE STRENGTH rail (new — cross-instrument alpha)

**Today:** Largo-only (`buildPeerRelativeStrength` in `technicals.ts` — 5d/10d/20d vs sector ETF). Swing taxonomy mentions RS but 0DTE discovery does not consume it.

**Target:** Persistent **relative alpha** vs QQQ + sector + thematic peer basket on **multiple horizons** (session, 5d, 10d).

Per ticker, compute:
```
NVDA  +1.8%
QQQ   +0.3%
SOXX  +0.6%
→ session alpha vs QQQ: +1.5%  |  vs SOXX: +1.2%
```

Signals:
- Session return minus QQQ / IWM / sector ETF (XLK, SOXX, SMH, …)
- Multi-day RS persistence (5d/10d/20d — reuse Largo bar math)
- RS **rank** within sector cohort (top decile = candidate)
- Downside RS for short-bias (persistent relative weakness)
- RS **acceleration** (alpha widening over last N bars)

Example:
> NVDA — session α +1.2% vs SOXX · 10d RS leading · rank 8/120 semis · RS accelerating

Why separate from MOMENTUM: a name can have flat absolute momentum but extreme RS (rotation day), or strong momentum but lagging RS (late chase). Expression engine uses both.

Files: `relative-strength-source.ts` · port pure math from `largo/technicals.ts` (no Largo round-trip).

### 3d. BREAKOUT rail (structural transitions — including COILED)

**Today:** Gain × volume screen. Not level-aware.

**Target:** Structural state machine — materially different from ordinary momentum.

#### COILED state (pre-trigger)

Compression **at a known level** with a defined trigger. Not "moving fast" — **loaded**.

Example (operator spec):
```
NVDA
  Resistance     181.50
  Current        181.32
  Relative vol   2.8×
  Flow           bullish
  Sector         strong (RS rail)
  Short gamma    yes
  STATE: COILED
→ 181.50 BREAK = trigger (commit thesis upgrades to TRIGGERED)
```

COILED candidates are **WATCH** or low-size until trigger; regime COMPRESSION weights them heavily.

#### TRIGGERED state (post-break)

Triggers:
- PDH / PDL break + hold
- Opening range / premarket H-L break
- VWAP reclaim/loss (confirmed)
- Multi-day / weekly resistance
- Compression → expansion
- **POSITIONING.WALL_BREAK** (gamma wall taken — see §3f)

Example:
> COIN — PDH 312.40 TRIGGERED 10:04 ET · 1.6× RVOL · VWAP reclaimed

Partial infrastructure: `intraday.ts`, prior-session OHLC (`spx-session.ts`), GEX walls, Vector BOS/CHoCH (wire to discovery).

Refactor: retire gain-only `screenBreakoutMovers` as primary; optional as universe pre-filter only.

### 3e. REVERSAL / MEAN REVERSION rail (anti-chase)

**Today:** PIN covers long-gamma **fade toward midpoint** only. No exhaustion/failed-break/first-touch reversal archetype. Engine structurally favors chasing in trend regimes.

**Target:** Counter-extension setups — completely different archetype from MOMENTUM/BREAKOUT longs.

Signals:
- Extreme RSI (dossier `rsi14` exists — use as evidence, not sole gate)
- Deviation from VWAP in σ (session vol-normalized)
- Expected-move extremes (Meridian `expected_move_pct` vs realized move)
- Failed breakdown / failed breakout (structural false break + reclaim)
- Liquidity sweep (stop-run wick + close back inside)
- Supportive gamma wall immediately under/over price (POSITIONING corroboration)
- Flow divergence (price lower but put aggression decelerating + call accumulation)
- Exhaustion volume (climax bar + stall)

Example:
```
META −5.2%
  2.1σ below VWAP
  put aggression decelerating
  call accumulation starting
  major put wall immediately underneath
→ REVERSAL LONG
```

Regime: PIN_REVERSION + HIGH_VOL_TWO_WAY ↑↑. G-1 tape-alignment must allow counter-trend **only** when REVERSAL origin + positioning evidence present (calibration-first — shadow before relaxing G-1).

Files: `reversal-source.ts` · reuse `flow-quality.ts` momentum/deceleration, `pin-source.ts` wall proximity.

### 3f. POSITIONING rail (evolve PIN → dealer geometry)

**Today:** `pin-source.ts` — long-gamma bracket fade only (`evaluatePinRegime`). Walls from GEX heatmap. Condor geometry separate.

**Target:** Broader **dealer positioning** engine. PIN becomes one archetype, not the whole rail.

Hunts:
- Gamma flip level + interactions
- King nodes, call/put walls, wall migration over session
- GEX concentration, VEX/charm behavior (matrix lenses)
- Positive → negative gamma transitions
- Dealer acceleration zones
- Pin regimes (existing)
- **VACUUM** — little positioning between spot and next wall (path of least resistance)

Archetypes emitted:

| Archetype | Meaning | Typical direction |
|-----------|---------|-----------------|
| **WALL_BREAK** | Price attacking / clearing major call/put wall | With break |
| **WALL_REJECTION** | Repeated rejections at defended node | Fade |
| **GAMMA_FLIP** | Regime transition at flip level | Trend follow post-flip |
| **PIN** | Long-gamma bracket fade (existing) | Toward midpoint |
| **VACUUM** | Thin GEX between spot and next node | Toward empty zone |

Example:
> NVDA — VACUUM to 185 call wall · 2.1% gap · short gamma · flow bullish → long with wide path

Existing: `pin-source.ts`, `pin-temporal-stability.ts`, `getGexPositioning()`, dossier `gamma_regime` / king strike.

Migration: rename origin `PIN` → `POSITIONING` with `positioning_archetype` sub-tag; keep PIN as archetype for backward-compatible ledger slices.

### 3g. CATALYST rail (news × tape — never news alone)

**Today:** `matchEarnings()` flags tickers reporting today; dossier carries `catalyst_flags`, Benzinga hot-news. G-11 blocks earnings **into** the print for 0DTE scalp — but no positive catalyst discovery rail.

**Target:** Scan catalyst **types**, then require **confluence**:

Catalyst types: earnings, guidance, analyst changes, FDA, M&A, macro exposure, breaking news, investor day, product launch (Benzinga channels + Meridian timeline).

**Admission rule:** CATALYST alone never commits. Require ≥2 of:
1. Catalyst present (typed, freshness-stamped)
2. Price reaction (≥ X% move post-headline or vs expected move)
3. Flow (CAMPAIGN or elevated gross in direction)
4. Structure (BREAKOUT TRIGGERED or RS leading)

Example (operator spec):
```
PLTR guidance raised
  → +8%
  → 3.9× RVOL
  → $18M call accumulation
  → breakout through weekly resistance
→ CATALYST + BREAKOUT + FLOW CAMPAIGN
```

Files: wire Meridian earnings intel + Benzinga (`polygon` news API) into `catalyst-source.ts`; reuse `matchEarnings`, `expected_move_pct`.

### 3h. Origin inventory (target)

| Origin | Role | Today |
|--------|------|-------|
| **FLOW** | Institutional options tape | Shipped (upgrade to CAMPAIGN) |
| **MOMENTUM** | Absolute tape dynamics | Missing (in BREAKOUT) |
| **RS** | Relative alpha vs QQQ/sector | Largo-only |
| **BREAKOUT** | Structural COILED/TRIGGERED | Gain screen only |
| **REVERSAL** | Anti-chase mean reversion | Missing |
| **POSITIONING** | Dealer geometry (incl. PIN) | PIN fade only |
| **CATALYST** | News × price × flow × structure | Flags only, no rail |
| **VOL** | IV mispricing + term structure | Largo/UW tools only; not in discovery |

### 3i. VOLATILITY rail (expression driver — the case for any-DTE)

**Today:** VIX band in `regime.ts`; `fetchUwIvRank`, `fetchUwIvRankSeries`, `get_iv_term_structure`, `get_realized_vol`, `get_risk_reversal_skew` exist for Largo/SPX shadow factors — **not** in 0DTE discovery or contract pick.

**Target:** Ask *"Is volatility itself mispriced?"* — options are not just direction bets.

Signals:
- IV rank / IV percentile (`fetchUwIvRank`, Polygon VIX rank fallback)
- Realized vs implied (`fetchRealizedVol` / UW realized-vs-implied)
- Term structure (contango / backwardation per expiry)
- Expected move vs realized (`expected_move_pct` from Meridian/chain)
- Event premium (earnings/FDA IV inflation)
- Skew (risk reversal, put/call wing)
- Vol expansion / compression (IV slope + RVOL of vol)

**VOL rail does NOT discover direction.** It scores whether the **option expression** is favorable:
- Directional thesis A+ but **0DTE IV rank 92** → expression picks **5 DTE** instead
- Event premium elevated → avoid front-weekly unless catalyst continuation archetype
- Backwardation → favor nearer expiry; contango → favor slightly longer DTE for same delta

Example:
```
NVDA directional thesis: excellent (RS 93, MOMENTUM 91)
VOL score: 68 — 0DTE IV rank 88, RV > IV, event premium none
→ Expression: 3–5 DTE (not 0DTE) — "direction right, vol entry wrong at 0DTE"
```

Files: `volatility-source.ts` · reuse `unusual-whales.ts` IV stats, `polygon-options-gex.ts` realized vol, chain implied vol at pick time.

**Cache-reader rule:** VOL reads ride existing UW Redis cache (`iv_rank:${ticker}`) — no per-request upstream flood.

---

## 4. Merge by ticker (multi-rail evidence panel)

**Merge:** Union by ticker. Each rail that fired retains its **independent 0–100 score**. Do NOT collapse to "came from FLOW."

Target card (operator spec):
```
NVDA  long
────────────────────────
FLOW             88   🐋 campaign
MOMENTUM         91
BREAKOUT         84   COILED → trigger 181.50
REL STRENGTH     93
POSITIONING      76   VACUUM
CATALYST         40
VOLATILITY       68
────────────────────────
Archetype: 🔥 Momentum Continuation (+ ⚡ Breakout trigger pending)
Rank: A+
Expression: 3 DTE (VOL — 0DTE IV too rich)
```

Implementation:
```ts
type MergedThesis = {
  ticker: string;
  direction: "long" | "short"; // majority vote or strongest rail
  rail_scores: Record<DiscoveryOrigin, number>; // only rails that fired
  rails_fired: DiscoveryOrigin[];
  trade_archetype: TradeArchetype;
  archetype_score: number; // from archetype-specific model, NOT generic blend
};
```

Persist `rail_scores` + `trade_archetype` on ledger `entry_context` for calibration slices.

**Anti-pattern today:** `discovery_origin: ["BREAKOUT"]` with score 65 and `gross: 0` — one rail, one number, no visibility into missing corroboration.

---

## 5. Trade archetypes (separate score models — NOT one generic model)

**Do NOT score all trades with one formula.** Each archetype has **core evidence rails** and its own scoring weights (calibration-first per archetype band on ledger).

| Archetype | Emoji | Core evidence rails | Score model emphasis |
|-----------|-------|---------------------|----------------------|
| **Momentum Continuation** | 🔥 | MOMENTUM + RS + FLOW | RS persistence, RVOL, VWAP hold; penalize late extension without RS |
| **Breakout** | ⚡ | BREAKOUT + MOMENTUM + VOL | Level trigger, volume confirm, COILED→TRIGGERED; VOL for post-break expansion |
| **Flow Following** | 🐋 | FLOW (CAMPAIGN) + RS | Persistence, acceleration, ask aggression; RS confirms not isolated whale |
| **Mean Reversion** | 🧲 | REVERSAL + POSITIONING | σ deviation, wall support, flow divergence; penalize trend-chase |
| **Gamma Break** | 💥 | POSITIONING (WALL_BREAK/GAMMA_FLIP) + BREAKOUT | Wall/flip transition, short gamma, volume through node |
| **Catalyst Continuation** | 📰 | CATALYST + BREAKOUT + FLOW | ≥3 pillars; price reaction vs expected move |
| **Failed Breakout** | ⚔️ | REVERSAL + BREAKOUT (failed) | Trap structure, reclaim, opposing flow; archetype for failed TRIGGERED |
| **Vol Expansion** | 🌊 | BREAKOUT (COILED) + VOL + MOMENTUM | Compression → expansion; vol compression score rising |

**Classifier (pure, deterministic):**
1. Evaluate which archetypes' **required rails** are present above floor (e.g. FLOW CAMPAIGN ≥70 → Flow Following candidate)
2. If multiple match, pick highest **core-rail agreement**; ties → regime prior (§2)
3. Run **only that archetype's score function** for rank — not a weighted average of all rail scores

Example: NVDA with RS 93, MOMENTUM 91, BREAKOUT 84 (COILED), FLOW 88 → primary **Momentum Continuation**, secondary **Breakout** (trigger pending). Rank uses Momentum model until 181.50 breaks, then may promote to Breakout model.

**Ledger:** persist `trade_archetype` + `rail_scores` alongside `discovery_origin`.

### 5b. Per-archetype gates (NOT one gate stack)

**A good reversal looks completely different from a good momentum trade.** Each archetype gets **its own scoring model AND its own gate thresholds.**

| Archetype | Gates that differ from generic |
|-----------|----------------------------------|
| **Momentum Continuation** | Require RS ≥ floor; penalize extension > Nσ without RS; G-1 tape-align strict |
| **Breakout** | Require TRIGGERED (not COILED alone for commit); volume confirm; chase cap post-break |
| **Flow Following** | Require CAMPAIGN class; min persistence minutes; aggression floor |
| **Mean Reversion** | **Relax G-1** when REVERSAL + wall evidence; require σ deviation + flow divergence |
| **Gamma Break** | Require short gamma + wall/flip evidence; block into building opposing wall |
| **Catalyst Continuation** | Require ≥2 confluence pillars; G-11 earnings window rules |
| **Failed Breakout** | Require failed TRIGGERED + reclaim; block if trend re-accelerates |
| **Vol Expansion** | Require compression score + expansion trigger; vol rising |

Generic hard gates (liquidity, plan quality, governor, regime-plane fail-closed) remain universal. Archetype gates run **after** merge, **before** Cortex.

Implementation: `archetype-gates.ts` — `evaluateArchetypeGates(archetype, candidate) → PASS | WATCH | BLOCK` with per-archetype env-tunable floors (calibration-first).

---

## 6. Cortex — judge, not discoverer

**Today:** Cortex (`cortex-gate.ts` + `nighthawk/cortex/`) runs on gate survivors and adds vetoes/score — partially aligned, but discovery and gates still happen option-first.

**Target:** Cortex runs **after** discovery produces a `Candidate` (merged thesis + archetype). It does NOT discover trades — it **judges** whether to COMMIT, WATCH, or REJECT.

```
Discovery → Candidate → Cortex → COMMIT | WATCH | REJECT
                              ↓
                    Contract Engine (if COMMIT or WATCH-with-expression)
```

### 6a. Cortex questions (10 dimensions)

| Dimension | Question | Primary inputs |
|-----------|----------|----------------|
| **Market alignment** | Does broader market support this? | SPY/QQQ tape, G-1, regime structure |
| **Sector alignment** | Does sector confirm? | RS rail, sector ETF trend |
| **Tape / Flow** | Does flow support? | FLOW rail, flow_quality, campaign class |
| **Structure** | Is entry location good? | BREAKOUT state, intraday OR/VWAP, PDH/PDL |
| **Positioning** | Are dealer levels supportive? | POSITIONING rail, gex walls, flip, vacuum |
| **Volatility** | Are we paying too much? | VOL rail, IV rank at candidate expiries |
| **Catalyst** | Any binary risk? | CATALYST rail, earnings, G-11 |
| **Liquidity** | Can users actually trade this? | Spread, OI, volume (Contract Engine pre-check) |
| **Timing** | Too early? Too late? | COILED vs TRIGGERED, session window, chase |
| **Risk/reward** | Room before opposing structure? | Wall path, expected move, target/invalidation geometry |

Verdict maps to:
- **COMMIT** — thesis + Cortex green + Contract Engine found expression
- **WATCH** — thesis interesting but trigger pending (COILED), Cortex thin, or no liquid contract yet
- **REJECT** — Cortex veto, archetype gate block, or net-negative evidence

Existing Cortex evidence composer (`composeCortexEvidence`) **extends** toward these dimensions — not replaced. Veto asymmetry + fail-closed veto-blind preserved (`NIGHTHAWK-CORTEX-DESIGN.md`).

---

## 7. Contract Engine (separate module — competitive advantage)

**Today:** `pickAtmZeroDteContract` / `buildContractPlan` attach ONE contract at discovery time, 0–4 DTE window but nearest-first bias baked in before thesis is scored.

**Target:** For a bullish NVDA thesis, **scan all liquid contracts across DTE** and rank expressions independently of "Night Hawk is a 0DTE system."

Example (operator spec):
```
NVDA LONG — contract scan
────────────────────────────
0DTE 182.5C   score 61   theta brutal   spread 8%
1DTE 182.5C   score 79   spread 3%
4DTE 185C     score 91   ← BEST EXPRESSION
7DTE 185C     score 83
────────────────────────────
→ Night Hawk chooses: Aug 29 185C (4 DTE)
  not because the system is "4DTE" — because it's optimal for today's thesis
```

### 7a. Contract score inputs

Each `(expiry, strike, call|put)` candidate scored on:
- **delta** (vs archetype target band from `horizons.ts`)
- **theta** (decay cost for intended hold)
- **gamma** (convexity vs hold horizon)
- **IV** (absolute + rank at this expiry)
- **spread** (% of mid — hard reject above floor)
- **OI + volume** (tradability)
- **expected move** (strike vs EM envelope)
- **distance to strike** (moneyness vs thesis)
- **DTE** (fit to archetype hold horizon)
- **target horizon** (0DTE ratchet vs 3–7D swing vs campaign expiry match)

Pure module: `src/lib/zerodte/contract-engine.ts` — `rankContractsForThesis(thesis, chain) → ContractCandidate[]`.

### 7b. Separation from discovery

| Layer | Owns |
|-------|------|
| Discovery rails | Underlying thesis + direction + rail_scores |
| Archetype | Score model + gates |
| Cortex | COMMIT / WATCH / REJECT judgment |
| **Contract Engine** | Which expiry/strike expresses the thesis best |
| Exit engine | How to manage once committed |

Contract Engine runs **only after** Cortex approves COMMIT (or WATCH with provisional expression for display).

**NO TRADE:** thesis A+ but every contract fails spread/liquidity/vol fitness → WATCH with honest empty state, never force 0DTE lotto.

---

## 8. Archetype score + confluence (replaces generic thesis score)

Within an archetype:
1. Score from archetype-specific weights on **core rails only**
2. × regime multiplier from §2
3. + bonus for **non-core corroborating rails** (e.g. Flow Following + RS 90)
4. − archetype-specific penalties (chase, rich IV at chosen DTE, solo rail)
5. Cortex veto unchanged

Confluence examples that must beat solo BREAKOUT on ledger:
- Flow Following: FLOW 88 + RS 93 + MOMENTUM 91
- Breakout: TRIGGERED + RVOL + FLOW campaign
- Mean Reversion: REVERSAL + put wall + flow divergence

**Anti-pattern today (2026-08-25 prod):** 29 BREAKOUT-only, 0 multi-rail merges, BMNR/COIN/MSTR commits with `gross: 0`.

---

## 9. Expression output (Contract Engine result)

```ts
type ExpressionDecision = {
  horizon: "ZERO_DTE" | "SWING" | "BANGER" | "CONDOR" | "NONE";
  dte_target: number;
  contract: ContractPlan;
  contract_score: number;
  alternatives: ContractCandidate[]; // top-N for drill-down UI
  exit_primitive: "RATCHET" | "SCALE_OUT" | "CONDOR";
  target_price: number | null;
  invalidation_price: number | null;
  risk_reward: number | null;
  vol_rationale: string | null;
};
```

**Horizon spine:** `horizons.ts` supplies target delta bands + exit routing — Contract Engine reads, does not hardcode DTE.

---

## 10. UI — "Best trades in the entire market" (rails hidden by default)

**Product question changes from:**
> "Here are some 0DTE scanner results."

**To:**
> "What are the best trades available in the entire market right now?"

### 10a. Surface (default)

```
NIGHT HAWK — TODAY

🥇 #1 NVDA — LONG          A+ · 94
   🔥 Momentum  🐋 Flow  ⚡ Breakout     4/5 systems aligned
   Entry trigger  181.50 ↑
   Contract       Aug 29 185C  (4 DTE)
   Target         186.20
   Invalidation   179.80
   Risk/Reward    3.4R

🥈 #2 META — LONG            A · 87
   🧲 Mean Reversion  🐋 Flow

🥉 #3 TSLA — SHORT           A · 84
   ⚡ Breakdown  💥 Gamma acceleration
```

Rails/systems shown as **badges**, not implementation detail. Rank = archetype_score × Cortex conviction × systems_aligned.

### 10b. Drill-down tabs

| Tab | Content |
|-----|---------|
| **THESIS** | Archetype, direction, trigger state, hold horizon rationale |
| **EVIDENCE** | Full rail_scores panel (FLOW 88, RS 93, …) |
| **CONTRACT** | Contract Engine scan table (0DTE vs 4DTE scores) |
| **MANAGEMENT** | Exit rules, trim/ratchet, thesis-break conditions |
| **TIMELINE** | Discovery time, trigger time, flow campaign span |

Existing Night Hawk deck (`/nighthawk`, Grid board) refactors to this shell — backend thesis-first, frontend simplified.

---

## 11. Rank + commit (surface)

Unified **Best Trades Today** rank across thesis survivors:

| Tier | Meaning |
|------|---------|
| A+ | ≥4 rails + COMMIT + Contract Engine score ≥90 + 3R+ |
| A | COMMIT + strong archetype + expression found |
| B | WATCH — COILED pre-trigger or thin Cortex |
| WATCH | Thesis valid, waiting on trigger or contract |
| REJECT | Cortex REJECT or archetype gate BLOCK |

---

## 12. Current codebase map

| Component | File(s) | Thesis-first status |
|-----------|---------|---------------------|
| Scan orchestration | `scan.ts` | Option-first; refactor to thesis pipeline |
| FLOW aggregation | `board.ts`, `flow-quality.ts` | Strong base; decouple DTE fetch |
| FLOW corroboration | `flow-corroboration.ts` | Tactical bridge; superseded by campaign-native FLOW |
| BREAKOUT | `breakout-source.ts`, `breakout-discovery.ts` | Gain screen — replace with COILED/TRIGGERED |
| MOMENTUM | — | **Missing** (folded into BREAKOUT) |
| RS | `largo/technicals.ts` | **Largo-only** — port to discovery |
| REVERSAL | — | **Missing** |
| POSITIONING / PIN | `pin-source.ts`, `pin-temporal-stability.ts` | PIN fade only — expand archetypes |
| CATALYST | `board.ts` `matchEarnings`, dossier flags | Flags only — no discovery rail |
| VOL | `unusual-whales.ts` IV rank, Largo vol tools | **Not in 0DTE** — expression gap |
| Archetypes | `play_type` DIRECTIONAL/CONDOR only | **Missing** — one score model today |
| Regime labels | `regime.ts` | Partial — extend axes |
| Rail weights | `market-state-engine.ts` | v0, 3 rails — extend to 8 |
| Regime fail-closed | `regime-plane.ts` | Keep commit gate |
| Intraday structure | `intraday.ts` | COILED/OR/VWAP — wire to BREAKOUT |
| GEX / walls | `getGexPositioning()`, heatmap API | POSITIONING rail input |
| Meridian catalysts | `meridian-earnings-intel.ts`, Benzinga | CATALYST rail input |
| Horizons / exits | `horizons.ts`, `exit-engine.ts`, `scale-out.ts` | Expression engine inputs |
| Bangers | `src/lib/banger/*` | Expression route, not merged ledger |
| Contract pick | `breakout-source.ts` `pickAtmZeroDteContract`, `board.ts` `buildContractPlan` | **Replace** with `contract-engine.ts` |
| Cortex | `cortex-gate.ts`, `nighthawk/cortex/` | Extend as post-thesis **judge** |
| Archetype gates | — | **Missing** |

---

## 13. Phased build order

### Operator priority path (foundation)

**Ship in this order** — everything else waits on this pair:

#### A. Six discovery rails (2–3 PRs, shadow → live)
1. **FLOW** — upgrade to CAMPAIGN classifier (extend existing)
2. **MOMENTUM** — new origin
3. **BREAKOUT** — COILED/TRIGGERED structural (replace gain screen)
4. **REVERSAL** — new origin + archetype gates (G-1 relax path)
5. **RS** — port from `largo/technicals.ts`
6. **POSITIONING** — expand PIN → wall/flip/vacuum archetypes

Each rail: shadow log → `rail_scores` on merge → origin-band calibration.

#### B. Contract Engine (1 PR — immediately after rails)
- `contract-engine.ts` — cross-DTE scan + rank
- Wire after Cortex COMMIT; shadow-compare vs today's `pickAtmZeroDteContract`
- **This is the product differentiator** — optimal expression, not default 0DTE

#### C. Thesis spine (parallel with A)
- Phase 1 types: `ThesisCandidate`, `MergedThesis`, `TradeArchetype`, archetype gates
- Merge panel + archetype classifier (unit-tested, flag-gated)

### Extended path (after foundation)

### Phase 0 — Tactical (shipped, deploy)
PR #2894: G-3/G-17 floors, post-breakout FLOW corroboration, flow score calibration.

### Phase 1 — Spec + types (1 PR)
- `src/lib/zerodte/thesis.ts` — all core types
- `archetype-gates.ts` — per-archetype gate tables
- `ZERODTE_THESIS_FIRST=0` shadow flag

### Phase 2 — Cortex judge refactor (1 PR)
- Resequence: discovery → candidate → Cortex (10 dimensions) → contract engine
- Map existing evidence sources to dimension table (§6a)

### Phase 3 — CATALYST rail (1 PR)
- Benzinga + Meridian; confluence gate

### Phase 4 — VOL rail (1 PR)
- Feed Contract Engine IV/term/skew inputs

### Phase 5 — Regime v1 (1 PR)
- 4-class taxonomy + rail weights

### Phase 6 — UI shell (1 PR)
- "Best Trades Today" rank + drill-down tabs (§10)

---

## 14. Success metrics (calibration-first)

Each phase must prove on graded ledger before gating:

1. **Multi-rail rate** — target >25% of commits with ≥2 origins (prod 2026-08-25: 0%)
2. **Origin-band WR** — FLOW+CAMPAIGN+BREAKOUT vs solo BREAKOUT
3. **Score monotonicity** — fix inverted 75–84 band (22% WR) vs 65–74 (48%)
4. **Expression fit** — same thesis graded by chosen DTE vs forced 0DTE counterfactual
5. **Regime conditioning** — REVERSAL WR in PIN_REVERSION vs TREND_EXPANSION; COILED→TRIGGERED hit rate
6. **RS lift** — RS+FLOW vs FLOW-only origin band
7. **POSITIONING.VACUUM** — path-to-wall vs random OTM counterfactual
8. **CATALYST confluence** — catalyst-only (blocked) vs catalyst+flow+structure
9. **VOL DTE counterfactual** — graded P&L at expression-chosen DTE vs forced 0DTE on same thesis
10. **Archetype bands** — Momentum Continuation WR vs Mean Reversion WR vs solo BREAKOUT
11. **Contract Engine lift** — P&L at optimized DTE vs forced 0DTE on same thesis (counterfactual)
12. **Systems aligned** — WR when ≥4 rails fire vs 1 (target multi-rail >25%)

---

## 15. Non-goals

- Collapsing banger/swing/legacy edition into one ledger (share signals, separate commits/exits)
- Regime-driven auto-commit (weights only until calibrated)
- Replacing Cortex/governor with ML ranker
- Staging environment (validate on prod shadow + sim board)

---

*This document captures operator intent from 2026-08-25 architecture review. Update as each phase lands.*
