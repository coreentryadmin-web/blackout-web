# Swing Engine V2 — Architectural Redesign

**Status:** design of record (proposed) · **Date:** 2026-09-05  
**Audience:** product, engineering, operators, AI agents  
**Horizon:** **4–15 DTE** tactical swing (operator window; live spine today is 5–15)  
**Companion:** `docs/audit/BLACKOUT-ENGINES-ARCHITECTURE.md`, `docs/audit/SWING-COMMAND-UNIFICATION.md`, `docs/audit/0DTE-UNIFICATION-DESIGN.md`

---

## 1. Executive thesis

The pre-unification Swing board failed members for three structural reasons:

1. **Recall collapse** — whole-market Tier-0 found names, but **Tier-1 enriched only 40** (`tier1Cap=40`) and structure screen capped at **40 movers**. Most market winners never reached scoring.
2. **Thin intelligence** — swing discovery used **flow + daily structure + Benzinga news** only. **Thermal GEX, Vector walls, HELIX corroboration, dark pool, Meridian catalyst geometry, and Cortex vetoes** — all live on 0DTE — were **never wired into swing commit decisions**.
3. **Parallel engines, merge-at-serve** — Banger and Vector ran **separate crons** and were **stitched onto the desk at read time**. Members saw a thin organic lane plus bolt-ons, not one coherent hunt.

**Swing Engine V2** is not a UI patch. It is a **0DTE-grade discovery + gate + cross-product veto stack**, retuned for multi-session holds:

| Dimension | 0DTE (reference) | Swing V2 (target) |
|-----------|------------------|-------------------|
| DTE window | 0–4 | **4–15** (tactical; sub-lanes 4–7 / 8–15) |
| Scan cadence | ~2 min RTH | Phase scans + **15m tactical refresh** for DTE ≤7 |
| Discovery origins | FLOW + BREAKOUT + PIN/GEX | FLOW + STRUCTURE + **POSITIONING** + **CATALYST** |
| Tier-1 budget | Dynamic 40–150 (breakout cap) | **Dynamic 80–200** with recall ledger |
| Cross-product | Cortex @ commit | **Cortex @ commit** (horizon=`swing`) |
| Persistence | Intraday only | **1–2 sessions** OR corroborated event |
| Exit geometry | Ratchet / trim_scale | **Underlying thesis first** + **trim_scale** premium leg |
| Thesis monitor | 12-pillar health index | **8-pillar swing health** vs frozen commit |

**North star:** produce the **highest win-rate, highest EV swing book** the platform can ground — not the most plays. Empty board beats ungrounded edge. But **recall must be visible**: every dropped name logged with reason.

---

## 2. Current state diagnosis (code-verified)

### 2.1 Funnel bottlenecks (`src/lib/swing/discovery.ts`)

```
~12,000 equities (Polygon grouped-daily)
    → FLOW screen: 120h UW, min $250k premium, limit 800
    → STRUCTURE screen: max 40 breakout movers
    → MERGE by ticker (corroborated ranks first)
    → Tier-1 enrich: top 40 only  ← PRIMARY RECALL LEAK
    → Persistence: ≥2 sessions (most archetypes)
    → Contract ranker: 0.50–0.75Δ, liquidity filters
    → Gates: structural enforce, edge evidence-only
    → Snapshot → Redis swing:serving:latest:v1
```

**Silent drops:** `cappedOut` recall metric exists but member never sees near-misses.

### 2.2 Data wiring gaps (`src/lib/swing/swing-ingest.ts` vs `src/lib/nighthawk/cortex/fetch.ts`)

| Source | 0DTE commit path | Swing discovery today |
|--------|------------------|----------------------|
| HELIX flow tape | Primary + accumulation | Tier-0 FLOW only |
| Thermal GEX / walls | Cortex `gex-walls`, board | **Not wired** |
| Vector full state | `fetchVectorFullState("0dte")` | **Badge only** at serve (`vector-lane-enrich.ts`) |
| Dark pool | Cortex `darkpool-confluence` | **Not wired** |
| Meridian desk | Thesis evidence | **Not wired** (UW earnings only) |
| BIE ecosystem | Cortex bundle | **Not wired** |
| Cortex veto | `evaluateCortexForCommit` | **Not wired** |

### 2.3 Engine fragmentation

- **Organic swing:** `swing-discovery` cron (5 phases/day)
- **Banger:** `banger-discovery` cron → `banger_positions` → merged in `banger-lane-merge.ts`
- **Vector:** `vector-pick-sweep` → `vector_pick_leaders` → score bump in `vector-lane-enrich.ts`

Members experience **one tab** (Swing Command) but the **hunt is three engines**. V2 **unifies discovery** under `runSwingDiscoveryScanV2` with Banger/Vector as **origins**, not post-hoc merges.

---

## 3. Design principles (inherited from 0DTE + BLACKOUT spine)

1. **Truth > reliability > volume** — `docs/NORTH_STAR.md`
2. **Fail-closed firewall** — structural + regime + Cortex blocks enforce; edge gates graduate on evidence
3. **Origin provenance never collapsed** — `signalKinds: [FLOW, STRUCTURE, POSITIONING, CATALYST, BANGER, VECTOR]`
4. **Calibration-first sizing** — floors/rungs graduate on graded ledger (reuse `zerodte/calibration.ts`)
5. **Cache-reader member APIs** — crons write; horizons route reads Redis/Postgres only
6. **Underlying thesis primary** — multi-day holds exit on **price invalidation** before premium bleed
7. **Recall visibility** — every cap drop → `swing_scan_rejections` table (mirror `zerodte_scan_rejections`)

---

## 4. Target architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ WRITERS (cron + WS)                                                          │
│  UW flow/WS · Polygon bars/chains · GEX/VEX/DEX · news · earnings · halts   │
│  Vector pick sweep · Banger post-close screen · Meridian catalyst cache    │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ HOT STORE                                                                    │
│  Redis: swing:serving:v2:{sessionDay} · swing:watch:v2 · banger:watch       │
│  Postgres: swing_candidate_accumulation · swing_positions · rejections ledger │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ SWING DISCOVERY V2  (`src/lib/swing/v2/scan.ts`)                             │
│                                                                              │
│  TIER-0 ORIGINS (parallel, whole-market)                                     │
│    O1 FLOW      — 120h accumulation + campaign class (HELIX)                 │
│    O2 STRUCTURE — grouped-daily breakout (dynamic cap 60–180)                │
│    O3 POSITION  — Thermal GEX + Vector walls + pin risk (5–15 DTE names)   │
│    O4 CATALYST  — Meridian/UW earnings drift + news impulse (event archetype)│
│    O5 BANGER    — post-close breakout screen (absorb banger-discovery)      │
│    O6 VECTOR    — vector_pick_leaders top-N (absorb as origin, not badge)    │
│                                                                              │
│  MERGE — preserve origin set; corroboration rank boost                       │
│                                                                              │
│  TIER-1 ENRICH (dynamic budget)                                              │
│    ingestSwingReadsV2 → BIE bundle + GEX + dark pool + group RS             │
│    thesis rails (8) → pillar score → archetype classify                      │
│                                                                              │
│  PERSISTENCE GATE — 1–2 sessions OR ≥2 signal kinds (event)                  │
│                                                                              │
│  CONTRACT — sub-lane ranker (TACTICAL 4–7 / STANDARD 8–15)                   │
│                                                                              │
│  GATE STACK — G-S1..G-S14 + Cortex(swing) + portfolio governor               │
│                                                                              │
│  COMMIT — budget/caps/idempotency (existing commit.ts)                       │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ ACTIVE MANAGEMENT  (`swing-active-refresh` + event-trigger)                    │
│  15m refresh (DTE≤7) · hourly (DTE>7) · underlying stops · trim_scale       │
│  thesis health index (8 pillars) · roll planner · scale-out ladder           │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ SERVE  (`getSwingServingLaneV2`)                                             │
│  7 sections · signal stack UI · near-miss WATCH rail · scan_as_of freshness   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Data fusion layer — use everything

New module: **`src/lib/swing/v2/data-fusion.ts`**

Single per-ticker bundle assembled in Tier-1 (batched, concurrency-capped):

| Pillar / rail | Primary reads | Fallback | Files |
|---------------|---------------|----------|-------|
| **Flow / HELIX** | `fetchRecentFlows` 120h, `flowAccumulationByTicker`, campaign class | WS freshness gate | `flow-accumulation-context.ts`, `db.ts` |
| **Structure** | Daily + optional 5m breakout refresh | Polygon grouped-daily | `candidates.ts`, `structure-levels.ts` |
| **Positioning** | `getGexPositioning(ticker)`, net GEX sign, flip distance | Vector `fetchVectorFullState(t, "weekly")` walls | `gex-positioning.ts`, `cortex/fetch.ts` |
| **Relative strength** | Industry group RS vs benchmark | Sector map | `industry-group-rs.ts` |
| **Volatility** | UW IV rank + series, term slope | — | `swing-catalyst.ts` |
| **Catalyst** | Benzinga news channels + **Meridian** event panel + UW earnings | `fetchMarketCatalysts` | `swing-catalyst.ts`, `meridian/*` |
| **Dark pool** | `fetchUwDarkPool`, Vector DP levels | — | `dark-pool/*`, Vector state |
| **Regime** | SPY trend + **breadth** + VIX term | `market_regime` table | extend `regimeFromSpyTrend` |
| **Dealer nodes** | GEX ladder peaks, gamma walls, charm cliffs | Thermal heatmap API | `gex-heatmap`, Vector walls |
| **BIE echo** | `fetchEcosystemContext(ticker)` | — | `ecosystem-context.ts` |

**Null-honesty rule (unchanged):** absent feed → `null` pillar, never fabricated zero.

**Concurrency budget:** 12 parallel enrich workers, 6s per-ticker timeout, SPY/regime fetched once per scan.

---

## 6. Discovery origins (six paths, 0DTE parity)

### O1 — FLOW (HELIX accumulation)

- Window: **120h** (unchanged)
- Lower premium floor for **corroborated** names: $150k if STRUCTURE also fired
- Campaign class tagging (multi-day directional stack)
- Output: `FlowAccumulationSignal` + HELIX direction confidence

### O2 — STRUCTURE (whole-market breakout)

- Reuse `screenBreakoutMovers` on Polygon grouped-daily
- **Dynamic cap** (copy `breakout-cap.ts` pattern):
  ```ts
  cap = clamp(ceil(qualifying * 0.35), 60, 180)
  ```
- Intraday refresh during POWER_HOUR phase (optional 5m bars)
- SHORT-side breakouts enabled where archetype = FAILED_BREAKDOWN / MEAN_REVERSION

### O3 — POSITIONING (Thermal + Vector walls) — **NEW**

- Universe: liquid optionable names from **Vector liquid set** + Tier-0 union
- For each candidate (batched):
  - `getGexPositioning(ticker)` — net GEX, flip level, wall integrity
  - Vector weekly walls — expected move vs spot, confluence zones
- Admit when: price approaching **gamma wall** with directional edge OR **positive gamma tailwind** into wall
- DTE filter: only contracts in **4–15** window considered
- Origin tag: `POSITIONING`

### O4 — CATALYST (Meridian + news impulse) — **NEW**

- Sources: `loadMeridianEventResponse`, UW earnings history, Benzinga channels
- Archetypes: `POST_EARNINGS_DRIFT`, `EVENT_DRIVEN`
- **Persistence shortcut:** 1 session if ≥2 independent kinds (CATALYST + FLOW or STRUCTURE)
- Print-window gate (adapt 0DTE G-11): no fresh COMMIT inside binary window without graduated override
- Origin tag: `CATALYST`

### O5 — BANGER (absorbed origin)

- Move `banger-discovery` screen into Tier-0 as origin **BANGER**
- Post-close grouped-daily screen (existing banger criteria)
- Commit path: still `banger_positions` ledger OR unified `swing_positions` with `origin=BANGER` (Phase 3)
- Removes duplicate cron in steady state

### O6 — VECTOR (absorbed origin)

- `vector_pick_leaders` recent rows → Tier-0 seeds with `VECTOR` origin
- Enrich with `fetchVectorFullState(ticker, "weekly")` in Tier-1 (not just badge)
- Vector G-17 style boost at gate: aligned wall trend + pick leader → confluence +1

---

## 7. Scoring — thesis rails + pillars

### 7.1 Eight swing thesis rails (new: `src/lib/swing/v2/thesis/rails/`)

Mirror 0DTE rail merge (`zerodte/thesis/merge.ts`) but multi-day windows:

| Rail | Inputs | Archetype affinity |
|------|--------|-------------------|
| `flow` | 120h accumulation, HELIX direction | FLOW_ACCUMULATION |
| `structure` | Breakout quality, ATR, levels | BREAKOUT, PULLBACK_CONTINUATION |
| `positioning` | GEX sign, wall distance, charm | BREAKOUT, MEAN_REVERSION |
| `momentum` | 10d return, EMA stack | BREAKOUT, SECTOR_ROTATION |
| `rs` | Industry group RS | SECTOR_ROTATION |
| `catalyst` | Earnings drift, news freshness | POST_EARNINGS_DRIFT, EVENT_DRIVEN |
| `vol` | IV rank, term slope | All (contract quality) |
| `regime` | SPY + breadth + VIX term | All (size modifier) |

Rail scores merge → **thesis score** (0–100). Archetype classifier picks primary archetype + sub-lane.

### 7.2 Seven pillars (retain `swing-pillars.ts` weights)

Archetype-weighted pillar blend unchanged — but pillars now fed by **data fusion** reads, not sparse ingest.

### 7.3 Confluence gate — **NEW (0DTE G-12 pattern)**

Independent confirmation kinds that must agree for COMMIT:

| Kind | Source |
|------|--------|
| FLOW | Accumulation campaign |
| STRUCTURE | Breakout / level break |
| POSITIONING | GEX/wall alignment |
| CATALYST | Earnings/news drift |
| RS | Group RS top quartile |
| VECTOR | Pick leader aligned |

**Default:** COMMIT requires **≥3 kinds** for standard archetypes, **≥2** for event archetypes with CATALYST present.

Near-miss (2 kinds) → **WATCH** with explicit "needs: POSITIONING" note.

---

## 8. Gate stack — `src/lib/swing/v2/gates.ts`

Ordered fail-closed gates (mirror `zerodte/gates.ts` discipline):

| Gate | Name | Enforce | Notes |
|------|------|---------|-------|
| G-S1 | Liquidity / spread | ✓ | Chain OI, bid-ask % |
| G-S2 | DTE window | ✓ | 4–15 (configurable) |
| G-S3 | Earnings binary | ✓ | No COMMIT inside window |
| G-S4 | Regime blind | ✓ | Degraded VIX/breadth → WATCH only |
| G-S5 | Persistence | ✓ | Sessions / corroboration |
| G-S6 | Confluence | ✓ | ≥N kinds |
| G-S7 | Score floor | graduate | Archetype×sub-lane buckets |
| G-S8 | R:R geometry | graduate | Min 1.8 reward/risk |
| G-S9 | Extended chase | graduate | >0.5×ATR past trigger |
| G-S10 | Theme concentration | ✓ | `theme-cluster.ts` |
| G-S11 | Portfolio heat | ✓ | Budget caps |
| G-S12 | Halt/LULD | ✓ | |
| G-S13 | Data quality | ✓ | Min pillars grounded |
| G-S14 | Cortex veto | ✓ | Opposing walls / whale / dark pool |

Every failure → `swing_scan_rejections` with `{ticker, gate, reason, score, origins, as_of}`.

---

## 9. Cortex for Swing — **critical gap close**

Extend `src/lib/nighthawk/cortex/fetch.ts`:

```ts
fetchVectorFullState(ticker, "swing" | "weekly")  // new horizon profile
evaluateCortexForCommit(ctx, { horizon: "SWING", dteWindow: [4, 15] })
```

**Swing Cortex sources** (reuse readers, new timeouts):

| Source | Veto? | Notes |
|--------|-------|-------|
| `gex-walls` | ✓ | Opposing wall into target |
| `wall-trend` | warn | Integrity decay |
| `darkpool-confluence` | ✓ | DP level against direction |
| `flow-quality` | ✓ | Whale opposition 120h |
| `catalyst-news` | warn | Negative impulse |
| `sector-heat` | warn | Group headwind |
| `expected-move` | warn | Already beyond EM |

Pre-warm Vector state for gate survivors (copy 0DTE scan pattern).

---

## 10. Contract selection — sub-lanes

Retain `contract-ranker.ts` philosophy; tighten for V2:

| Sub-lane | DTE | Delta target | Theta policy |
|----------|-----|--------------|--------------|
| **TACTICAL** | 4–7 | 0.55–0.70 | Faster scale-out, 15m manage |
| **STANDARD** | 8–15 | 0.50–0.65 | trim_scale ladder, hourly manage |

**New:** positioning-aware strike — prefer strikes **inside supporting gamma wall** for BREAKOUT longs (Vector + Thermal ladder).

**Liquidity floors** (per sub-lane): min OI, max spread%, min premium — unchanged enforcement.

---

## 11. Persistence & anti-lone-print

Retain `accumulation-store.ts` keyed on `(ticker, direction, archetype)`:

| Archetype class | Sessions required | Shortcut |
|-----------------|-------------------|----------|
| Cross-session (BREAKOUT, FLOW, etc.) | **2** distinct session days | 1 if ≥3 confluence kinds |
| Event (POST_EARNINGS_DRIFT, EVENT_DRIVEN) | **1** | Must have CATALYST + 1 other kind |

**Observed rail:** first sighting → `OBSERVED` in Redis + member "forming" card (not hidden).

---

## 12. Management & exit

Retain **underlying-thesis-first** precedence (`manage.ts`):

1. Structural stop (underlying invalidation)
2. Thesis stop (archetype-specific)
3. Expiry risk (sub-lane cliff DTE)
4. Premium backstop (−60%)
5. Advisory rungs (graduate via calibration)

**V2 additions:**

| Feature | Source pattern | Cadence |
|---------|----------------|---------|
| `trim_scale` premium ladder | `zerodte/scale-out.ts` | Frozen at commit in `exitPolicy` |
| Thesis health overlay | `zerodte/thesis-health.ts` → `swing/thesis-health.ts` | 15m / 1h |
| Flow decay exit | HELIX 24h reversal | Advisory → graduate |
| Positioning drift | GEX flip crossed wrong way | Thesis break |
| Roll planner | `roll.ts` | When DTE < migrate threshold |

**Cadence:**

- DTE ≤7: **15m** `swing-active-refresh` + WS marks
- DTE 8–15: **hourly** refresh
- Event-trigger: large flow print → immediate mark (`event-trigger.ts`, already exists)

---

## 13. Thesis health — 8 pillars (Command Deck)

Extend `computeSwingThesisHealth` (P0 shipped) to V2 reads:

| Pillar | V2 live read |
|--------|--------------|
| persistence | Setup state + sessions held |
| entry_geometry | Trigger distance, ATR chase |
| flow_corroboration | HELIX 24h direction vs commit |
| regime | SPY + breadth alignment |
| theta_budget | DTE vs sub-lane cliff |
| **positioning** | GEX sign vs commit (**new**) |
| **catalyst_freshness** | News/earnings age (**new**) |
| **dark_pool** | DP level hold/break (**new**) |

Maps to shared `ThesisHealthPayload` for Command Deck parity with 0DTE.

---

## 14. Serving & member experience

### 14.1 Board sections (unchanged taxonomy)

`COMMIT_NOW | WAITING_FOR_ENTRY | WATCH | RESEARCH | MANAGING | SCALING_OUT | EXITING`

### 14.2 New surfaces

| Surface | Purpose |
|---------|---------|
| **Signal stack chip** | Shows which of 6 kinds fired (FLOW·STRUCTURE·GEX·CAT·RS·VEC) |
| **Near-miss rail** | Top 10 rejected at confluence-1 with "almost" reason |
| **Recall badge** | `scan_as_of` + "42 names screened · 8 watch · 2 commit" |
| **Cortex status** | Green/yellow/red cross-product veto summary on COMMIT rows |

### 14.3 Empty board copy

Honest: "No swing setups cleared the confluence bar this session" + link to near-miss rail.

---

## 15. Unification — retire parallel engines

| Today | V2 steady state |
|-------|-----------------|
| `banger-discovery` cron | Origin O5 inside `swing-discovery` |
| `banger-lane-merge.ts` at serve | **Removed** — rows born with `origin=BANGER` |
| `vector-lane-enrich.ts` badge | Origin O6 + full state in Tier-1 |
| Separate banger commit | **Phase 3:** optional merge into `swing_positions` |

Night Hawk stays **3 tabs** (0DTE · Swings · Legacy). No Banger/Vector tabs.

---

## 16. Metrics & success criteria

### 16.1 Funnel metrics (log every scan)

| Metric | Target (RTH week) |
|--------|-------------------|
| Tier-0 union size | 200–600 names |
| Tier-1 enriched | 80–200 (dynamic) |
| Persistence-eligible | 30–80 |
| COMMIT-eligible (post-gates) | 5–20 |
| Cap drop rate | <30% of Tier-0 |
| Cortex veto rate | measured, not hidden |

### 16.2 Quality metrics (graded ledger)

| Metric | Target |
|--------|--------|
| 30d win rate (COMMIT) | ≥55% (graduate floors until met) |
| Avg winner / avg loser | ≥2.0 R |
| Thesis-break precision | <15% false exits |
| Recall@commit (backtest) | Top-decile movers captured ≥40% |

### 16.3 Operational

| Check | Command |
|-------|---------|
| Funnel health | `npm run scan:swing` |
| Portfolio sim | `npm run sim:swing-portfolio` |
| UI validate | `npm run validate:swing-command-ui` |

---

## 17. Implementation roadmap

### Phase P0 — Command Deck parity ✅ (PR #3787)
Live deck, thesis health panel, cockpit strip, analytics, `scanAsOf`. **Awaiting Claude review.**

### Phase P1 — Data fusion + dynamic recall (2 weeks)
- [ ] `src/lib/swing/v2/data-fusion.ts`
- [ ] Dynamic Tier-1 cap + `swing_scan_rejections` ledger
- [ ] Lower FLOW floor for corroborated names
- [ ] Near-miss rail in serving snapshot
- [ ] Env: `SWING_TIER1_CAP_MIN=80`, `SWING_TIER1_CAP_MAX=200`

### Phase P2 — POSITIONING + CATALYST origins (2 weeks)
- [ ] O3 POSITIONING screen (GEX + Vector walls)
- [ ] O4 CATALYST screen (Meridian + earnings drift)
- [ ] Confluence gate G-S6
- [ ] Signal stack UI chips

### Phase P3 — Cortex + gate graduation (2 weeks)
- [ ] `evaluateCortexForCommit({ horizon: "SWING" })`
- [ ] G-S4 regime blind, G-S14 Cortex enforce
- [ ] Graduate G-S7..G-S9 from calibration buckets
- [ ] Absorb banger-discovery into O5

### Phase P4 — Management density + engine unification (2 weeks)
- [ ] 15m tactical refresh (DTE≤7)
- [ ] Thesis health V2 pillars (positioning, catalyst, dark pool)
- [ ] Positioning-aware strike ranker
- [ ] Retire `banger-lane-merge` serve-time splice
- [ ] Vector origin O6 full integration

### Phase P5 — Calibration close the loop (ongoing)
- [ ] Bucket graduation dashboards
- [ ] `sim:swing` regression suite on 90d tape
- [ ] Auto-tune floors per archetype×sub-lane

---

## 18. Module map (new / modified)

| Module | Action |
|--------|--------|
| `src/lib/swing/v2/scan.ts` | **NEW** — orchestrator |
| `src/lib/swing/v2/data-fusion.ts` | **NEW** — per-ticker bundle |
| `src/lib/swing/v2/gates.ts` | **NEW** — G-S1..G-S14 |
| `src/lib/swing/v2/confluence.ts` | **NEW** — kind counting |
| `src/lib/swing/v2/origins/positioning.ts` | **NEW** — O3 screen |
| `src/lib/swing/v2/origins/catalyst.ts` | **NEW** — O4 screen |
| `src/lib/swing/v2/rejections.ts` | **NEW** — ledger writer |
| `src/lib/swing/discovery.ts` | **WRAP** — delegate to v2 behind flag |
| `src/lib/swing/swing-ingest.ts` | **EXTEND** — call data-fusion |
| `src/lib/nighthawk/cortex/fetch.ts` | **EXTEND** — swing horizon |
| `src/lib/nighthawk/cortex/gate.ts` | **EXTEND** — swing commit eval |
| `src/app/api/cron/swing-discovery/route.ts` | **WIRE** — `SWING_ENGINE_V2=1` |
| `src/lib/swing/banger-lane-merge.ts` | **DEPRECATE** — Phase 4 |
| `src/lib/swing/vector-lane-enrich.ts` | **DEPRECATE** — Phase 4 |

**Feature flag:** `SWING_ENGINE_V2=1` (cron only, off by default until P2 complete).

---

## 19. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Provider timeout at scale | Batched enrich, 6s cap, dynamic cap lowers on slow scans |
| Too many COMMITs (precision drop) | Confluence + Cortex enforce; graduate score floors |
| Too few COMMITs (recall drop) | Recall ledger visible; dynamic cap; near-miss rail |
| Banger regression | O5 runs same screen; A/B shadow mode 2 weeks |
| Cortex latency | Pre-warm top-N survivors only |
| Doc drift | This file is design of record; update `SWING-SYSTEM.md` at P4 |

---

## 20. Immediate next actions

1. **Merge #3787** (P0 Command Deck) after Claude adversarial review on rebased HEAD `aea0a0751`
2. **Open Phase P1 PR** — data fusion + dynamic cap + rejections ledger (no member-visible behavior change until flag on)
3. **Shadow run** — `SWING_ENGINE_V2=1` in cron dry-run logging only for 1 week
4. **Operator review** — confirm 4–15 vs 5–15 DTE window (`horizons.ts` one-line change if 4 adopted)

---

*This document supersedes ad-hoc swing expansion notes. Implementation PRs must reference phase IDs (P1–P5) and must not merge without adversarial peer review per `CLAUDE.md`.*
