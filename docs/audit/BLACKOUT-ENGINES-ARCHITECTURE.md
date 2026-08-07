# BlackOut Engines — Unified Architecture (0DTE + Swing)

**Status:** design of record · **Date:** 2026-07-30  
**Audience:** product, engineering, operators, AI agents  
**Goal:** architect the strongest intraday (0DTE) and multi-session (Swing) options engines
that can exist under BlackOut's constraints — **Truth > Reliability > every trade is grounded or
not shown**, calibration-first (nothing sizes real money until graded evidence says so), and EV-maximizing
exit management as the primary edge.

**Companions (do not duplicate — this doc unifies them):**
- `docs/audit/0DTE-UNIFICATION-DESIGN.md` — 0DTE phase plan + firewall
- `docs/audit/SWING-SYSTEM.md` — Swing operator guide
- `docs/audit/INTENTIONAL-DESIGN.md` — deliberate choices + measurement to revisit
- `docs/NORTH_STAR.md` — priority order when goals conflict
- `docs/audit/FINDINGS.md` — live forensics (incl. 2026-07-30 session)

---

## 1. Executive thesis — what “strongest ever” means here

Not “most plays” or “highest headline win-rate.” **Strongest** means:

1. **Never open measured-losing risk** — fail-closed firewall; empty board beats a −EV commit.
2. **Never scratch measured-winning risk** — exit engine locks in green when tape offers it (today’s
   session proved the opposite: MU +132% MFE closed −21%; SNDK +66% MFE closed −1%).
3. **Never show ungrounded edge** — calibrated probability / EV stay `null` until buckets graduate.
4. **One spine, two horizons** — same discovery primitives, scoring philosophy, calibration ladder,
   and provider/cache discipline; different DTE, persistence, and exit geometry.
5. **Regime-aware, not one-strategy-fits-all** — FLOW momentum, BREAKOUT continuation, PIN fade,
   iron condor (sell premium), and Swing multi-day thesis are **routed**, not blended into mush.
6. **Evidence loop is the moat** — every gate, router, and exit flip graduates on the graded ledger
   (n≥10, Wilson-LB delta≥15pts) before it enforces.

---

## 2. The shared spine (both engines)

Both 0DTE Command Deck and Night Hawk Swing sit on one platform layer:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ WRITERS (cron + market-worker WS)                                       │
│  UW flow · Polygon chains/bars · GEX/VEX · news/catalysts · halts       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ HOT STORE — Redis snapshots + Postgres durable ledger                     │
│  Never per-request provider calls on member paths                       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ SHARED ENGINE PRIMITIVES (src/lib/)                                       │
│  horizon-plays · horizon-fanout · flow-accumulation · screenBreakout    │
│  buildContractPlan · calibration ladder · FreshnessChip semantics         │
└───────────────┬─────────────────────────────┬───────────────────────────┘
                ▼                             ▼
     ┌──────────────────────┐      ┌──────────────────────┐
     │ 0DTE (0–4 DTE)       │      │ SWING (5–30 DTE)     │
     │ scanZeroDteBoard     │      │ runSwingDiscoveryScan│
     │ session governor     │      │ persistence memory   │
     │ trim/ratchet/condor  │      │ thesis manage + roll │
     └──────────────────────┘      └──────────────────────┘
```

### 2.1 Shared invariants (non-negotiable)

| Invariant | 0DTE | Swing |
|-----------|------|-------|
| Cache-reader member APIs | ✓ | ✓ |
| Tier / tool gates | ✓ | ✓ |
| Origin provenance persisted | FLOW/BREAKOUT/PIN set | FLOW/STRUCTURE/CATALYST kinds |
| Calibration-first commit | Governor + score floor | Graduation ladder + budget |
| Honest empty/stale | ✓ | ✓ |
| Feature vector frozen at commit | ✓ | ✓ |
| Two-way commit door | ✓ | ✓ (idempotent thesis key) |

### 2.2 Shared “Regime Plane” (new — closes today’s Polygon gap)

Today’s 2026-07-30 session exposed a structural hole: **commits opened while regime inputs were
degraded** (VIX unknown, UW-fallback GEX, Cortex absent sources) but **exits still fired thesis
vetoes on those same degraded walls**.

**Regime Plane** is a single Redis snapshot written by ingest/cron, read by both engines:

```typescript
interface RegimeSnapshot {
  as_of: string;
  vix: { value: number | null; source: "polygon" | "uw" | null; stale: boolean };
  spx_gamma: "long" | "short" | "unknown";
  polygon_rest: "healthy" | "degraded" | "down";  // from provider-health-reconcile
  gex_quality: "polygon_chain" | "uw_strike_fallback" | "empty";
  macro: { read_ok: boolean; block_fresh_commits: boolean };
  confidence: "high" | "degraded" | "blind";  // derived — drives fail-closed
}
```

**Rules:**
- `confidence === "blind"` → **no fresh commits** on either engine (watch/research OK).
- `gex_quality !== "polygon_chain"` → **thesis/gex-walls exit requires corroboration** (second
  source or spot-structure break) before killing a runner.
- Surfaced on desk via `FreshnessChip` — never silent degradation.

---

## 3. 0DTE Engine — “Command Deck” architecture

**Horizon:** 0–1 DTE · **Hold:** minutes–hours · **Member surface:** `/nighthawk` (0DTE lane) +
legacy board API `/api/market/zerodte/board`.

### 3.1 Discovery — three independent origins (never collapse)

| Origin | Source | What it finds | Graduation unit |
|--------|--------|---------------|-----------------|
| **FLOW** | Multi-day whale prints (top-N premium) | Intent / stacking | `origin=FLOW` band |
| **BREAKOUT** | Whole-market movers (intraday minute agg RTH) | Price/volume continuation | `origin=BREAKOUT` band |
| **PIN** | GEX wall geometry + long-gamma range | Mean-reversion fade | `origin=PIN` band |

Merge **by ticker**, preserve origin **as a set** (`FLOW+BREAKOUT`, etc.). Multi-origin corroboration
boost only when the **origin band** earns it on graded evidence (never hand-set +8).

**Cross-cutting overlay (not an origin):** multi-day flow accumulation direction — must **align or
explicitly conflict-flag** at commit. (MU long while accumulation bearish = hard block once calibrated.)

**2026-07-30 lesson:** 13/15 commits were BREAKOUT-only crypto/miner cluster — the board behaved as
a momentum chaser in the worst window. **Architecture fix:** BREAKOUT origin carries its **own**
score floor and concurrency cap, graduated independently from FLOW. High BREAKOUT score must not
borrow FLOW’s historical WR.

### 3.2 The negative-play firewall (ordered cheap → precise)

Fail-closed stack for **fresh commits only** (existing positions degrade gracefully):

| Layer | Gate | Purpose |
|-------|------|---------|
| 0 | Plan quality (spread, chase, quote) | Untradeable |
| 0+ | Aggression evidence floor | Kill roll/hedge stacks |
| 0+ | Far-OTM cap | Kill lotto tails |
| **0++** | **Regime Plane blind** | **No commit when VIX/GEX/macro unreadable** |
| 1 | Score floor 65 (per-origin calibrated) | Non-monotonic score bands |
| 2 | Confluence ≥2 | Only measured +EV bucket (+15.9%) |
| 3 | G-1 tape alignment | Counter-tape block |
| 4 | Entry window ≥10:00 ET | Early window 36.8% WR |
| 5 | G-4 VIX / G-7 macro fail-closed | Volatile-day leak |
| 6 | Governor (concurrency, stops, correlation) | Blast-radius |
| 7 | Cortex vetoes — abstain ≠ drop veto sources | Wall / whale protection |
| 8 | Accumulation direction conflict | Multi-day overlay |

**Cortex abstain policy (Phase 0):** if **both** veto-capable sources (`gex-walls`, `flow-quality`)
failed to read → **HOLD**, not commit. Non-veto absences still abstain.

### 3.3 Play-type router (regime-conditional)

Two play types, one discovery funnel:

| Play type | When | Geometry | Grader |
|-----------|------|----------|--------|
| **DIRECTIONAL** | Short-gamma / trend / wall fade with confluence | Long premium −50%/+100% | `gradePlanFromBars` |
| **IRON CONDOR** | Long-gamma / range / PIN regime | Sell premium beyond walls | Breach-inside-shorts |

Router ships **evidence-only** until `play_type_bands` graduates (Phase 5). Default: DIRECTIONAL.

### 3.4 Exit engine — the #1 EV lever (redesign)

**Problem (proven 2026-07-30 + prior counterfactuals):** ratchet + aggressive thesis-break on
degraded GEX turns green tape red. Hold-to-close on same OCC bars: **7W/8L**; live exits: **1W/14L**.

**Target architecture — “Trim-Scale + Thesis Discipline”:**

```
Entry ──► +25% ──► trim ⅓ (banked, never red on that slice)
      ──► +50% ──► trim ⅓
      ──► runner ⅓ ──► time-stop 15:30 OR target +100% OR hard −50%
      
Thesis break ──► ONLY when:
  (a) regime.gex_quality === "polygon_chain" OR spot broke structure level, AND
  (b) Cortex gex-walls veto with fresh read (<900s), AND
  (c) not within +25% trim window without re-confirmation pass
```

| Mode | Default for | Rationale |
|------|-------------|-----------|
| `trim_scale` | A/B tier | Dominates ratchet in every E5 backtest window |
| `ratchet` | C tier / ungraded | Conservative until bucket graduates |
| `condor_hold` | CONDOR play_type | Hold-to-close + breach stop |

**Never:** breakeven ratchet that scratches +50% MFE names. **Always:** latch peak/trough for
honest member P/L display (already shipped).

Env override: `ZERODTE_EXIT_MODE` — graduation flips default per tier band, not operator hunch.

### 3.5 Session governor (ledger-derived, replica-safe)

- Max concurrent (uncapped setups vs capped legacy — calibrate separately)
- Session stop halt (3 stops → halt new commits)
- Correlated concentration (e.g. max 2 same-theme crypto longs — **2026-07-30 would have blocked 6th miner**)
- Re-entry lock after stop
- Loss floor (−120% session) — informational + halt

**New:** theme/cluster tag on commit (`crypto_miner`, `semis`, `index`) from sector map — governor
uses it for concentration, calibration slices by it.

### 3.6 0DTE data flow (one page)

```
EventBridge */2min RTH + zerodte-warm
        │
        ▼
scanZeroDteBoard()
  ├─ discover FLOW / BREAKOUT / PIN (parallel, flag-gated)
  ├─ merge by ticker (preserve origin set)
  ├─ attachContractPlan (mandatory)
  ├─ gate stack + Cortex + Regime Plane
  ├─ governor filter
  ├─ commit → Postgres ledger + Redis board snapshot
  └─ mark loop (sources marks) → exit engine → close/trim

Post-close: zerodte-grade cron → plan_outcome + direction_hit → calibration bands
```

---

## 4. Swing Engine — “Multi-Session Thesis” architecture

**Horizon:** 5–30 DTE · **Hold:** days–weeks · **Surface:** `/nighthawk?view=swings`.

### 4.1 Philosophy — opposite failure mode from 0DTE

| 0DTE failure | Swing antidote |
|--------------|----------------|
| Act on first sighting | **Persistence gate** (≥2 sessions or corroborated event) |
| Scratch winners same day | **Thesis-first management** — structural stop before premium noise |
| Overtrade correlated basket | Portfolio budget + per-archetype caps + graduation |
| Show fake edge | `calibratedProbability = null` until bucket clears |

**2026-07-30 lesson:** empty board looked “broken” but cron enriched 24 names — **UX failure**, not
pipeline failure. Architecture must **surface building memory** in RESEARCH.

### 4.2 Discovery — two-tier whole market

**Tier-0 (cheap):**
- FLOW screen — 120h accumulation, directional only
- STRUCTURE screen — grouped-daily breakout movers (~12k names)

**Tier-1 (cap 40, concurrency 8):** enrich → 7 pillars → archetype → dossier → horizon play.

**Phase-anchored cadence (5×/day):** POST_CLOSE (primary), PRE_OPEN, MIDDAY, POWER_HOUR, OVERNIGHT.
Atomic Redis claim per `(session_day, phase)`.

### 4.3 Archetype + persistence (the swing moat)

Eight archetypes, three sub-lanes (TACTICAL/STANDARD/EXTENDED). Persistence keyed on
`(ticker, direction, archetype)` — never `(ticker, direction)` alone.

| Archetype class | Persistence rule |
|-----------------|------------------|
| Building (breakout, flow, sector, pullback, mean-rev) | ≥2 distinct session days |
| Event (event-driven, post-earnings, failed-breakdown) | 1 session + ≥2 independent signal **kinds** |

Signal kind = FLOW | STRUCTURE | CATALYST — **not** cadence phase (anti-lone-print).

### 4.4 Seven-section serving (observable triage)

| Section | Entry condition |
|---------|-----------------|
| RESEARCH | Observed, not persistence-cleared — **show count + thesis sketch** |
| WATCH | Persistence-cleared, pre-trigger |
| WAITING_FOR_ENTRY | Triggered but ungraduated bucket or no fill |
| COMMIT_NOW | Triggered + graduated + budget + caps |
| MANAGING / SCALING_OUT / EXITING | Open book states |

**Architecture addition:** RESEARCH carries `observation_count`, `sessions_seen`, `signal_kinds[]`,
`last_score` — member sees “building” not “dead.”

### 4.5 Commit gate (four ANDs)

1. **Graduation** — Wilson-LB ladder for archetype×sub-lane bucket  
2. **Contract** — near-ITM liquid plan, OCC stored  
3. **Budget** — portfolio % + theme caps  
4. **Idempotency** — one open root per `(ticker, direction, archetype)`

Cold book ⇒ COMMIT_NOW permanently empty — **by design** until ~10–15 graded closes per bucket.

### 4.6 Management — mark-and-review with honest labels

Active refresh every **15m RTH** (post-2026-07-30). Underlying-thesis rungs gate regardless of
graduation:

1. Structural stop (plan invalidation)  
2. Thesis break (regime flip)  
3. Premium backstop (catastrophic)  
4. Scale-out / roll (when graduated + geometry supports)

**Never claim** intrahour precision from 15m samples — UI says “last reviewed at …”.

### 4.7 Swing data flow

```
EventBridge swing-discovery (phase windows)
        │
        ▼
runSwingDiscoveryScan()
  ├─ Tier-0 FLOW + STRUCTURE → merge
  ├─ Tier-1 enrich (8-wide)
  ├─ observeSwingCandidate → Postgres accumulation
  ├─ fetchWatchEligible → persistence-cleared only
  ├─ commit gate (graduation ∧ contract ∧ budget)
  └─ persistSwingServingSnapshot → Redis swing:serving:latest:v1

EventBridge */15 swing-active-refresh
  ├─ mark open positions
  ├─ manage sync → snapshots
  └─ optional roll

Member: GET horizons?view=SWING → assembleSwingServingLane (cache read only)
```

---

## 5. Cross-engine integration

### 5.1 Shared discovery, different gates

Same `screenBreakoutMovers` and `flowAccumulationByTicker` — fork **after** Tier-0:

| Signal | 0DTE uses | Swing uses |
|--------|-----------|------------|
| Breakout mover | Same-day contract + intraday agg | Multi-day dossier + 14 DTE default |
| Flow stack | 0–1 DTE premium | 120h window, no DTE cap |
| GEX walls | PIN + condor + Cortex | Pillar input only |

### 5.2 Unified calibration ledger

One analytics plane slices by:

- `horizon` (ZERO_DTE | SWING)  
- `discovery_origin` or `archetype×sub_lane`  
- `regime.confidence` at commit  
- `theme_cluster`  
- `exit_policy` version  

Graduation runner (`scripts/audit/*`, post-close crons) feeds a single **Engine Scorecard** admin
tile — both engines, one truth.

### 5.3 Member UX — institutional desk

- **0DTE:** Command Deck with origin badges, tier factors, trim ladder state, regime chip  
- **Swing:** Seven sections with building-memory RESEARCH, graduation badges, “provisional floor”  
- **Shared:** No grey text; FreshnessChip on every live number; empty = honest reason string  

---

## 6. Measurement & graduation loop (the competitive moat)

Every behavioral change follows:

```
Hypothesis → flag-gated ship → graded ledger accumulates → band hits n≥10
→ Wilson-LB delta ≥ 15pts vs baseline → auto-promote to enforced gate
→ else revert or keep evidence-only
```

**Offline harnesses (already committed):**

| Question | Tool |
|----------|------|
| Did merge policy v2 beat v1? | `merge-precedence-ab.mjs` |
| Should Cortex have dwell? | `veto-flicker-rate.mjs` |
| Do stable PIN walls grade better? | `wall-temporal-stability.mjs` |
| Is BREAKOUT cap leaking winners? | `discovery-recall-probe.mjs` |
| Session P/L before/after firewall? | `firewall-rth-replay.mjs` |
| Exit mode EV? | `zerodte-sim.mjs --grade=DATE` |
| Whole pipeline live? | `healthcheck:0dte`, `healthcheck:swing` |

**New harnesses (architecture backlog):**

| Question | Tool |
|----------|------|
| Thesis exit on degraded GEX counterfactual | `gex-thesis-exit-ab.mjs` |
| Regime-blind commit rate | extend `firewall-rth-replay` |
| Swing RESEARCH → WATCH conversion funnel | `swing-persistence-funnel.mjs` |

---

## 7. Phased build roadmap (priority-ordered)

### Wave A — Stop bleeding (1–2 weeks, pure risk reduction)

| # | Work | Engine | Evidence |
|---|------|--------|----------|
| A1 | Regime Plane snapshot + blind fail-closed | Both | 2026-07-30 VIX unknown commits |
| A2 | Thesis exit requires `gex_quality !== fallback` OR structure break | 0DTE | MU/SNXX/NBIS forensics |
| A3 | Cortex veto-source protection (Phase 0 firewall) | 0DTE | 0DTE-UNIFICATION §2 |
| A4 | G-4/G-7 fail-closed fresh commits | 0DTE | Same |
| A5 | Theme concentration governor (crypto cluster) | 0DTE | 6 correlated miners |
| A6 | Swing RESEARCH surfacing (observation counts) | Swing | Empty board UX |

### Wave B — EV unlock (2–4 weeks)

| # | Work | Engine |
|---|------|--------|
| B1 | `trim_scale` default for A/B tier (graduate per band) | 0DTE |
| B2 | Confluence-2 commit gate (calibration-first) | 0DTE |
| B3 | Per-origin score floors (BREAKOUT ≠ FLOW) | 0DTE |
| B4 | Accumulation direction conflict block | 0DTE |
| B5 | Swing calibration ladder first graduates (COMMIT_NOW unlock) | Swing |

### Wave C — Discovery completeness (4–8 weeks)

| # | Work | Engine |
|---|------|--------|
| C1 | BREAKOUT intraday minute-agg (not grouped-daily mid-RTH) | 0DTE |
| C2 | PIN temporal stability gate (if measurement warrants) | 0DTE |
| C3 | Condor router graduation | 0DTE |
| C4 | Dynamic BREAKOUT cap from recall probe | Both |
| C5 | Swing STRUCTURE intraday path for event archetypes | Swing |

### Wave D — Regime router & scale (8+ weeks)

| # | Work | Engine |
|---|------|--------|
| D1 | Play-type router enforced post-graduation | 0DTE |
| D2 | Banger scale-out on unified discovery ladder | 0DTE |
| D3 | Cross-engine theme risk budget | Both |
| D4 | Full Engine Scorecard + auto-throttle weak origin bands | Both |

---

## 8. Success metrics (how we know it’s “strongest”)

| Metric | 0DTE target | Swing target |
|--------|-------------|--------------|
| Graded session avg P/L | Positive after firewall Phase 1 | Positive per graduated bucket |
| Never-green rate | ↓ vs baseline | N/A (multi-day) |
| MFE capture ratio | live_pnl / mfe ≥ 0.4 median | scale-out capture ≥ 0.5 |
| Fail-closed integrity | 0 commits when Regime blind | 0 COMMIT_NOW when ungraduated |
| Provider 429s | 0 | 0 |
| Cross-tool numeric mismatch | 0 | 0 |
| Member empty-state clarity | 100% with reason | RESEARCH shows building count |

---

## 9. What we deliberately do NOT build

- **No per-request provider calls** on member paths — ever.  
- **No staging environment** — prod validation via read-only harnesses only.  
- **No hand-tuned “magic” thresholds** without a graduation band.  
- **No second parallel GEX path** — single `getGexPositioning()`.  
- **No Swing intraday scalping** — that’s 0DTE’s job.  
- **No fabricated WR/EV** on the desk — null until graduated.  

---

## 10. Summary — one sentence each

**0DTE:** Three-origin whole-market discovery through a fail-closed firewall, regime-blind commit
blocked, trim-scale exit that banks green before thesis vetoes fire on degraded data.

**Swing:** Two-tier whole-market discovery through a persistence gate that shows building memory
honestly, commits only graduated archetype buckets, manages thesis-first over days.

**Together:** One spine, one calibration loop, one Regime Plane — the strongest options intelligence
desk that can exist without lying to members about edge that hasn’t been earned yet.
