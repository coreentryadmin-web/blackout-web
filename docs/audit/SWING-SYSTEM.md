# Night Hawk Swing — Complete System Guide

**Audience:** engineers, operators, and AI agents who need to understand Swing end-to-end.  
**Product surface:** `/nighthawk?view=swings` (Night Hawk → **Swings** tab)  
**Status:** live on production; calibration-first (cold book ⇒ nothing commits until buckets graduate).  
**Companions:**
- `docs/audit/SWING-ENGINE.md` — original build plan + PR ledger  
- `docs/audit/SWING-CTO-AUDIT-2026-07-29.md` — 2026-07-29 deep audit findings  
- `docs/audit/FINDINGS.md` — living issue log  

---

## 1. What Swing is (and is not)

### What it is

**Night Hawk Swing** is BlackOut’s multi-session options thesis engine for **5–30 DTE** equity/index options. It:

1. Screens the **whole market** (not a fixed watchlist) for directional setups  
2. Scores each name with a **7-pillar, archetype-weighted** evidence model  
3. Promotes names only after **cross-session persistence** (or corroborated event signals)  
4. Picks a **directional near-ITM contract** (≈0.50–0.75Δ), not a cheap 0DTE lottery ticket  
5. Opens a **model ledger position** only when calibration + budget + caps + idempotency all clear  
6. Manages open risk with **underlying-thesis-first** exits (structural stop, thesis break, premium backstop, optional roll)  
7. Grades every closed/rolled leg with a **5-family grader** (reference execution / observed path / thesis / model management / marked financial) and feeds a Wilson-LB graduation ladder  

### What it is not

| System | Role | How Swing differs |
|---|---|---|
| **0DTE Command Deck** | Same-day (0–1 DTE) Night Hawk board | Session lottery; premium ratchet; no multi-day persistence |
| **Legacy Night Hawk Edition** | Next-day stock playbook (`/edition`) | No option contract / DTE / roll chain |
| **SPX Slayer** | SPX/SPXW 0DTE matrix + plays | Index-only, GEX-driven, not swing-scored |
| **Vector** | Dark-pool + wall beads / technicals | Different product; not the swing commit ledger |
| **Thermal** | GEX heatmaps | Positioning view only |

Swing reuses the **horizon spine** (`horizons.ts`, `horizon-fanout.ts`, `horizon-plays.ts`, `horizon-board.ts`) and the **0DTE calibration primitives** — it does not fork them.

---

## 2. Product surface (what members see)

### Route & access

- **URL:** `https://blackouttrades.com/nighthawk?view=swings`  
- **Auth:** signed-in + premium tier + `nighthawk` tool access (`LAUNCHED_TOOLS` / admin bypass)  
- **UI shell:** `NightHawkFeed` → `HorizonDeck(horizon="SWING")` → `CommandDeck`  
- **Poll:** horizons API ~30s (deck); SWR on `/api/market/nighthawk/horizons?view=SWING`

### Seven serving sections (action triage)

The desk is **not** a flat “committed / watch” list. Each play lands in exactly one section, keyed only on **observable** state (setup maturity, entry stance, live status, management action) — never on an ungraduated probability/EV.

| Section | Meaning | Member action |
|---|---|---|
| **COMMIT_NOW** | Triggered + at trigger + floor cleared + **bucket graduated** | Act now |
| **WAITING_FOR_ENTRY** | Live thesis, no clean fill — **or** clean fill on an **ungraduated** bucket | Wait / do not treat as model commit |
| **WATCH** | Forming, or under commit floor | Keep watching |
| **RESEARCH** | Unclassified, invalidated, or thin data | Dig deeper / skip |
| **MANAGING** | Open + thesis intact | Hold to plan |
| **SCALING_OUT** | Open + banking / trailing | Manage scale-out |
| **EXITING** | Exit signalled (thesis broke / backstop / forced) | Exit / roll path |

Back-compat fields `committed` / `watch` still exist on the API for older consumers; the real member grouping is `lanes.SWING.sections`.

### Honesty rules (member-facing)

- Every number is live or honestly empty — **no fabricated edge**  
- `calibratedProbability` / `expectedValue` stay **literal null** until a bucket graduates  
- `scoreFloorGraduated: false` until the ladder clears the floor → desk shows **floor provisional**  
- Missing setup read on Swing → thesis **unknown**, never a fake “intact” green  

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROVIDERS (shared Redis cache)                        │
│  Polygon grouped-daily · daily bars · last trade · option chain/snapshot     │
│  UW flows · IV rank · earnings · Benzinga/news (via Polygon key)             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┴─────────────────────────┐
          ▼                                                   ▼
┌──────────────────────────┐                    ┌──────────────────────────────┐
│  CRON: swing-discovery   │                    │ CRON: swing-active-refresh   │
│  Phase-anchored (5/day)  │                    │ Hourly (RTH weekdays)        │
│  Discover → Score →      │                    │ Spot + mark → snapshot →     │
│  Persist → Gate → Commit │                    │ manage → optional ROLL       │
└────────────┬─────────────┘                    └──────────────┬───────────────┘
             │                                                 │
             ▼                                                 ▼
┌──────────────────────────┐                    ┌──────────────────────────────┐
│ Postgres                 │                    │ Postgres                     │
│ swing_candidate_         │                    │ swing_positions              │
│   accumulation           │                    │ swing_position_snapshots     │
│ (persistence memory)     │                    │ (ledger + longitudinal path) │
└────────────┬─────────────┘                    └──────────────┬───────────────┘
             │                                                 │
             ▼                                                 │
┌──────────────────────────┐                                   │
│ Redis                    │◄──────────────────────────────────┘
│ swing:serving:latest:v1  │  (scored dossiers + plays + watch)
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ GET /api/market/         │
│   nighthawk/horizons     │  → assembleSwingServingLane → Command Deck
└──────────────────────────┘
```

### Code geography

| Area | Path |
|---|---|
| Core engine | `src/lib/swing/*` (~33 modules) |
| Horizon spine | `src/lib/horizons.ts`, `horizon-*.ts`, `swing-signals.ts` |
| Discovery cron | `src/app/api/cron/swing-discovery/route.ts` |
| Refresh cron | `src/app/api/cron/swing-active-refresh/route.ts` |
| Member API | `src/app/api/market/nighthawk/horizons/route.ts` |
| Hunt (user scan) | `src/app/api/market/nighthawk/hunt/route.ts` (`mode: "swing"`) |
| UI | `src/features/nighthawk/command-deck/*`, `NightHawkFeed.tsx` |
| Schema / accessors | `src/lib/db.ts` (`swing_*` tables) |
| Healthcheck | `scripts/audit/swing-e2e-healthcheck.mjs` (`npm run healthcheck:swing`) |

---

## 4. Taxonomy (the vocabulary everything shares)

Canonical source: `src/lib/swing/taxonomy.ts`. Every consumer imports from here.

### 4.1 Archetypes (8)

Single-winner classifier (`classifyArchetype`) — one label per name, priority tie-break when fits are close.

| Archetype | Idea | Persistence |
|---|---|---|
| **BREAKOUT** | Range/base break on volume | ≥2 distinct sessions |
| **PULLBACK_CONTINUATION** | Retrace to rising support in trend | ≥2 sessions |
| **MEAN_REVERSION** | Stretched move snapping back | ≥2 sessions |
| **FLOW_ACCUMULATION** | Multi-day stacked options positioning | ≥2 sessions |
| **SECTOR_ROTATION** | Industry-group RS leadership | ≥2 sessions |
| **EVENT_DRIVEN** | Catalyst window | 1 session **+** ≥2 independent signal kinds |
| **POST_EARNINGS_DRIFT** | Post-print drift | 1 session **+** corroboration |
| **FAILED_BREAKDOWN** | Break support → immediate reclaim | 1 session (structure reclaim is the thesis) |

**Anti-lone-print invariant:** a single raw sighting never promotes for event archetypes without a second independent signal kind (FLOW / STRUCTURE / CATALYST) **or** a second session. FAILED_BREAKDOWN is the deliberate exception (Tier-0 already volume/close-strength filters).

### 4.2 Sub-lanes (3 contract classes)

| Sub-lane | DTE | Contract stance | Notes |
|---|---|---|---|
| **TACTICAL** | 2–7 | ~0.65Δ (0.55–0.75) | Fast theta; harsh earnings hazard |
| **STANDARD** | 8–21 | ~0.60Δ (0.50–0.72) | Default balanced swing |
| **EXTENDED** | 22–30 | ~0.55Δ (0.50–0.70) | Slower structures / run-ups |

Resolved by `subLaneForDte(dte)`. Outside `[2,30]` → no swing contract class.

### 4.3 Setup & entry states (pre-entry observables)

- **Setup:** `FORMING` → `TRIGGERED` → `EXTENDED` → `INVALIDATED`  
- **Entry:** `PRE_TRIGGER` → `AT_TRIGGER` → `PULLBACK_TO_ENTRY` → `EXTENDED_CHASE`  

The serving router keys on these — a 91-score name that already ran past trigger is **WAITING_FOR_ENTRY**, not COMMIT_NOW.

---

## 5. The pipeline (stage by stage)

### Stage A — Discovery cadence (`scan-cadence.ts`)

EventBridge fires `GET /api/cron/swing-discovery` on a **wide UTC band**. The route asks `decideSwingScan()` which **ET phase** (if any) this firing belongs to, and runs **once per (session day, phase)**.

| Phase | ET window | Role |
|---|---|---|
| **POST_CLOSE** | 16:15–20:00 | Primary — full session printed (ships first) |
| **PRE_OPEN** | 06:00–09:15 | Overnight / pre-market positioning |
| **MIDDAY** | 12:00–13:00 | Stable intraday checkpoint |
| **POWER_HOUR** | 15:00–16:00 | Closing drive confirmation |
| **OVERNIGHT** | 20:00–24:00 | Late / after-hours repositioning |

**Idempotency:** Redis NX claim `swing:discovery:{ymd}:{phase}`  
- Running TTL ~3 min (abort recovery)  
- Success → DONE TTL ~22h  
- Failure → claim **released** so the next fire can retry  
- Persist failure of the serving snapshot must **not** upgrade to DONE (member board would stay stale)

`maxDuration: 120` on the route; Lambda/ALB idle timeout must match (≥120s).

---

### Stage B — Two-tier whole-market screen (`discovery.ts`)

#### Tier-0 (cheap, whole market)

1. **FLOW screen** — multi-day accumulation over ~120h of flow (no `max_dte` cap, unlike 0DTE). Directional names only (bull/bear; neutrals dropped).  
2. **STRUCTURE screen** — `screenBreakoutMovers` over Polygon grouped-daily (~12k names): gain, volume, close-strength, $-volume rank.  

**Merge:** union by ticker. Names on **both** paths are corroborated and ranked first.  
**FM#1:** a STRUCTURE-only name with **no flow** still proceeds (FLOW pillar absent — honest, not dropped).

Cap: top **`tier1Cap` (40)** enriched per phase. Recall instrumentation records who the cap severed (`cappedOut`).

#### Tier-1 (per-name enrich, concurrency 8)

For each seed, `ingestSwingReads` / `assembleSwingDossierInput` gathers:

- Daily closes (name + SPY + industry-group ETF when needed)  
- Flow accumulation signal  
- Catalyst news + earnings windows  
- IV rank (volatility pillar)  
- SIC → industry-group RS (sector rotation)  
- Breakout-mover extras when Path-B  

Then: `swingSignalsFromReads` (canonical direction signing) → `classifyArchetype` → `scoreSwingPillars` → `buildSwingDossier`.

**Intended DTE:** default 14 (STANDARD). Catalyst/short-horizon theses shorten; archetype map can realign sub-lane (event → TACTICAL).

**Plan levels:** from last close + ATR proxy → entry / structural invalidation / target (~1.8R). Pinned onto the dossier for commit.

---

### Stage C — Persistence gate (`accumulation-store.ts`)

Table: `swing_candidate_accumulation`  
Key: `(ticker, direction, archetype)` — thesis identity. Live-flow / unclassified sightings use
`UNCLASSIFIED` and never merge into a classified thesis. An archetype flip starts a fresh persistence
row (does not inherit another thesis's `distinct_session_days`).

Each scan **observes** directional dossiers:

- Increments `observation_count`  
- Tracks `distinct_session_days`  
- Unions `signal_kinds` (FLOW / STRUCTURE / CATALYST) — **not** cadence phases  
- Records `phases_seen` for provenance only  

**WATCH-eligible** when the archetype’s persistence rule clears **and** the name appears in **this** scan (`seenThisScan`). Stale memory alone does not surface.

**Fade:** rows not touched for ~14 days are faded so zombie `distinct_session_days` cannot resurrect a dead thesis.

Promotion to WATCH ≠ commit. Nothing sizes risk here.

---

### Stage D — Contract ranker (`contract-ranker.ts`)

For each directional dossier with a chain:

1. Explode chain rows (`horizon-fanout`)  
2. Filter by sub-lane DTE window + direction + delta band + liquidity  
3. Score **tradability × thesis-fit**  
4. Pick one contract — **0.50–0.75Δ directional**, not the 0.35Δ banger  

`produceHorizonPlays` stamps `COMMIT` vs `WATCH` vs the lane’s score floor (provisional until graduated).

---

### Stage E — Gates (`gates.ts`)

3-way verdict: **COMMIT / WATCH / SKIP**

**Structural (enforced):** liquidity, quote staleness, incomplete daily bar, earnings/binary event in window (fail-closed on thin context), thesis invalidated.

**Edge (evidence-only until graduated):** reward/risk floor (~1.8R), entry extended (>0.5×ATR past trigger).

Score floor: `score ≥ max(archetypeFloor, subLaneFloor)` → COMMIT vs WATCH at the gate layer (still not a live open).

---

### Stage F — Commit (`commit.ts`) — real money

A WATCH candidate becomes an **OPEN** ledger row only if **all four** clear:

1. **Graduation** — `analyzeArchetypeRecord` ∧ `analyzeSubLaneRecord` both `floorGraduated` (staged Wilson-LB; cold book ⇒ nothing graduates ⇒ nothing commits)  
2. **Armed portfolio budget** — $100k reference account; 2% per-trade / 6% total heat / 3% event / 4% overnight (`enforce:true`; env overridable)  
3. **Book-% caps** — per-position / theme / total / same-week concentration  
4. **Idempotency** — `commit_key = {session}:{TICKER}:{SUBLANE}:{long|short}`  

**Sizing model:** one **reference contract** (premium × 100 = model risk USD). Members size to their own capital at serve time; the ledger is the model lot.

**Pinned at insert (critical for management):**

- Contract identity (strike / expiry / type / **OCC** / delta)  
- `entry_underlying_px`, `thesis_invalidation_px`, `target_underlying_px`  
- Entry premium + graduation/budget evidence in `entry_context` / `gate_calibration_json`  

Without OCC and invalidation levels, premium_stop and structural_stop cannot fire — those fields are load-bearing, not optional metadata.

---

### Stage G — Serving snapshot → member board

After a successful discovery scan:

```
persistSwingServingSnapshot({
  asOf, sessionDay, dossiers, plays: playSet.SWING, watch: watchCandidates
})
→ Redis key swing:serving:latest:v1 (TTL ~26h)
```

Member path (`discoverSwingFromPersisted`):

1. Read snapshot (no provider IO on the request path)  
2. Gate plays to persistence-cleared thesis `(ticker, direction, archetype)` only  
3. Enrich with serving meta (factors, regime, setup/entry when reads exist)  
4. `assembleSwingServingLane` → seven sections  
5. Splice into `HorizonBoard.lanes.SWING` (always, not only `?view=swings`)  
6. Merge OPEN ledger rows into MANAGING / SCALING_OUT / EXITING (live sections)  
7. Setup maturity from cron-warmed `spotsByTicker` + dossier plan levels (cache-reader) 

Horizons route auth: premium + nighthawk tool; `Cache-Control: no-store`.

---

### Stage H — Active refresh & management (`swing-active-refresh`)

**Schedule:** hourly, weekdays, market hours (`0 11-21 * * 1-5` UTC catalog).  
**Model:** **hourly mark-and-review** — not responsive intrabar live management.

This loop samples spot + option mark once per hour and evaluates management rungs on that sample.
It can detect a structural break / premium backstop / scale cue **as of the sample**, but it cannot
claim stop-first intrabar precision, catch intrahour touch-and-recover, or support minute-level
tactical management. Tactical (2–7 DTE) premium can move substantially between samples.

**Faster per-sub-lane cadence (1–5m tactical / 5–15m standard / 15–30m extended) is a deliberate
follow-up** — requires EventBridge schedule split + provider rate-budget math. Until then, describe
and operate this as hourly mark-and-review only.

**Never opens a new thesis.** Only refreshes / manages / optionally rolls.

For each OPEN position:

1. Load underlying spot (last trade)  
2. Load option mark (OCC from ledger, or reconstruct from strike/expiry/type)  
3. Compute DTE, sessions held, structural stop level from pinned invalidation  
4. `planManageSync` → `evaluateSwingManagement`  
5. Latch live state + **append-only** snapshot (`swing_position_snapshots`)  
6. If a **gating** rung says EXIT/ROLL and a roll plan can freeze the parent grade → atomic `withSwingRollTx` (close+grade parent, open child)

#### Management rung precedence (`manage.ts`)

**Gating (capital preservation — act):**

1. `expiry_risk` — DTE too short for the thesis  
2. `structural_stop` — underlying through thesis invalidation (any premium P&L)  
3. `thesis_stop` — archetype-specific invalidation  
4. `premium_stop` — ≈−60% option backstop  

**Advisory (evidence-only until ladder graduates the rung):**

- Profit ladder / scale-out (`TAKE_PARTIAL`, trailing runner)  
- `time_stop` — held ≥ sub-lane sessions with stagnant thesis progress  

**Roll vs close:** a still-valid thesis with a time/theta problem may **roll** (further-out child, same thesis). A **broken** thesis **closes** — never rolls into a dead idea.

---

### Stage I — Grade → calibrate → (maybe) graduate

**5-family grader** (`grade.ts`) — orthogonal families, never averaged. Honest names below reflect
what the **available data** can establish today. Stronger words (“execution truth”, “path truth”)
are reserved for when real fills + sufficiently fine bars are actually supplied; the code still
uses short enum keys (`EXECUTION` / `PATH` / …) with per-family `gradeable`/`ungradeable` flags.

| Family (honest label) | Code key | What it can establish today |
|---|---|---|
| **REFERENCE_EXECUTION** | `EXECUTION` | Planned entry vs an **actual fill when present**; otherwise ungradeable (`no_fill`). Commit `entry_premium` is a **chain mid / reference mark**, not a proven executable fill (no bid/ask side, latency, or fill-probability model). |
| **OBSERVED_PATH** | `PATH` | Underlying MFE/MAE / stop touch on the **bars actually supplied**. Resolution = those bars (minute when present for TACTICAL; else coarser). Hourly live snapshots alone do **not** establish intraday path. |
| **THESIS** | `THESIS` | Invalidation before target on the walked underlying series (stop-first **within a bar** of that series — only as fine as the bars). |
| **MODEL_MANAGEMENT** | `MANAGEMENT` | Managed-exit model vs naive hold on the **same option series** financial used — grades the rule given the marks it saw, not whether live hourly manage fired on time. |
| **MARKED_FINANCIAL** | `FINANCIAL` | Scale-out P&L via `gradeBangerScaleOut` on option marks/bars — **marked** P&L, not broker-realized. Truncated forward series → ungradeable (never imputed). |

**Roll-chain record** (`record.ts`): composite WIN requires **all** legs positive; parent loss is preserved.

**Calibration ladder** (`calibration.ts`) — staged Wilson lower-bound:

| Stage | n | Meaning |
|---|---|---|
| RESEARCH | &lt;10 | No enforcement |
| PROVISIONAL_SHADOW | 10–29 | Shadow only |
| LIMITED | 30–74 | Can graduate floors |
| BROAD | ≥75 | Broad enforcement candidate |

Graduation also needs Δ ≥ ~15pt vs off-signal. Calibration **returns verdicts** — flipping `scoreFloorGraduated` / `enforce` is a deliberate code/PR change, not an automatic live write.

---

## 6. Real-time day in the life (operator view)

### Pre-open (≈06:00–09:15 ET)

- PRE_OPEN phase may fire once → Tier-0/1 scan → accumulation advances  
- Board serves last night’s snapshot until a fresh persist lands  
- Healthcheck: expect serving GREEN even if sections empty  

### RTH

- MIDDAY / POWER_HOUR phases may each fire once  
- `swing-active-refresh` hourly **mark-and-review**: marks, snapshots, manage, rolls (not intrabar live mgmt)  
- Members poll horizons; desk updates from Redis snapshot (not per-request provider fan-out)  

### Post-close (≈16:15–20:00 ET) — primary discovery

- Cleanest full-session accumulation read  
- POST_CLOSE scan is the main WATCH/commit funnel for the next session  
- Fade stale accumulation rows  

### Overnight

- OVERNIGHT phase may capture late repositioning  
- No hourly refresh off RTH (market_hours_only)  

### Why the board can be empty (and that’s OK)

1. **Quiet tape** — Tier-0 found nothing worth enriching  
2. **Persistence building** — names seen once; need a second session / corroboration  
3. **Cold graduation** — no archetype×sub-lane bucket has graduated → `commitEligibleCount = 0` → no OPEN positions  
4. **No liquid contract** — persistence cleared but chain ranker found nothing tradeable  

Empty + structured sections = honest. Fabricated plays = forbidden.

---

## 7. Data model

### `swing_candidate_accumulation`

Pre-commit memory: observations, distinct days, signal kinds, phases, promotion link.

### `swing_positions`

Roll-chain ledger:

- Identity: ticker, direction, sub_lane, archetype, commit_key (UNIQUE)  
- Contract: strike, expiry, type, occ, delta  
- Plan: entry / invalidation / target underlying  
- Live: premium latches, underlying MFE/MAE, status ladder  
- Grade blobs + entry_context / gate_calibration_json (first-write-wins COALESCE)  
- Roll links: `parent_position_id`, `root_position_id`, `roll_seq`  
- Status: `PENDING → OPEN → HOLD → TRIM → CLOSED | ROLLED` (monotonic)  

### `swing_position_snapshots`

Append-only path series for the grader and trajectory studies (feature_vector column reserved; hook may still be incomplete — see CTO audit follow-ups).

---

## 8. APIs & ops

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/cron/swing-discovery` | Cron bearer | Phase-anchored discovery |
| GET | `/api/cron/swing-active-refresh` | Cron bearer | Hourly manage/refresh |
| GET | `/api/market/nighthawk/horizons?view=swings` | Premium + tool | Member board |
| GET | `/api/market/nighthawk/horizons` | Premium + tool | All lanes (SWING spliced) |
| POST | `/api/market/nighthawk/hunt` | Premium + tool | User swing hunt (`mode:"swing"`, DTE 2–30) |
| GET | `/api/market/nighthawk/record` | Premium + tool | Track record (Wilson helpers shared) |

### Env knobs (budget)

| Env | Default | Effect |
|---|---|---|
| `SWING_CAPITAL_USD` | `100000` | Reference account |
| `SWING_PER_POSITION_LOSS_PCT` | `2` | Per-trade risk |
| `SWING_MAX_PORTFOLIO_LOSS_PCT` | `6` | Total heat |
| `SWING_EVENT_EXPOSURE_CAP` | `3` | Event archetypes aggregate |
| `SWING_OVERNIGHT_CAP` | `4` | Overnight exposure |
| `SWING_BUDGET_ENFORCE` | `true` | Set `0`/`false` to disarm |

Graduation flags (`scoreFloorGraduated`, pillar-weight graduated, edge `enforced`) are **code constants**, not env — change via PR after evidence.

### Validation

```bash
npm run healthcheck:swing          # A–G matrix vs prod
npm run scan:swing                 # offline discovery funnel
npm run sim:swing                  # position / grade simulation
npm run sim:swing-portfolio        # portfolio allocation backtest
npx tsc --noEmit
node --import tsx --experimental-test-module-mocks --test src/lib/swing/**/*.test.ts
```

Cron health: registry keys `swing-discovery`, `swing-active-refresh` in `src/lib/cron-registry.ts`.  
Schedule catalog: `railway.swing-discovery.toml` (`*/30 * * * 1-5`) + `railway.swing-active-refresh.toml`
(`0 11-21 * * 1-5`). EventBridge rules are synced from these via
`blackout-infra/scripts/sync-cron-schedules.mjs` — a TOML add alone does not create the rule until sync runs.

---

## 9. Design laws (do not weaken)

1. **Truth > everything** — null is honest; fabricated zero is a lie.  
2. **Calibration-first** — no live risk sizing from ungraduated floors/weights/rungs.  
3. **Persistence-gated** — multi-session (or corroborated event) before WATCH; never lone-print commits.  
4. **Underlying-thesis-primary management** — structural/thesis stops beat premium P&L; premium backstop is last capital line.  
5. **Cache-reader member path** — horizons reads Redis snapshot; never fan out whole-market providers per request.  
6. **Pure core / thin IO** — discovery, gates, manage, grade are unit-tested without live DB/providers.  
7. **No public tech-stack disclosure** — never name providers in member-facing copy.  
8. **Cold book is a rail, not a bug** — zero graduated buckets ⇒ zero commits.

---

## 10. How to extend safely

| Goal | Where to start | Caution |
|---|---|---|
| New archetype | `taxonomy.ts` + `archetype.ts` + pillar weights | Persistence rule + priority order |
| New gate | `gates.ts` | Structural vs evidence-only |
| Tighter budget | `swing-portfolio-budget.ts` / env | Reference account ≠ per-member capital |
| Desk UX | `HorizonDeck` / `serving.ts` sections | Don’t route on raw score/EV |
| Graduation flip | Calibration report + PR | Never auto-write enforce flags |
| New provider field | Ingest → dossier → commit pin | Management must receive it in refresh reads |

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Dossier** | Versioned carrier: direction, archetype, pillars, score, sub-lane, plan levels |
| **WATCH** | Persistence-cleared, shown; not yet a live open |
| **Floor clear (play status COMMIT)** | Score cleared the (possibly provisional) lane floor — geometry/gate only |
| **COMMIT_NOW (section)** | Floor clear + triggered + at trigger + **archetype×sub-lane graduated** — member may act |
| **Open / model ledger** | Real `swing_positions` row after graduation + budget + caps + idempotency |
| **Sub-lane** | Tactical / Standard / Extended contract class by DTE |
| **Serving section** | One of seven desk triage buckets |
| **Roll** | Close+grade parent + open linked further-out child (same thesis) |
| **Graduation** | Wilson-LB ladder cleared for a bucket → may enforce floors/rungs / unlock COMMIT_NOW |
| **Reference lot** | Model 1-contract risk (premium×100) on the $100k reference book |

---

## 12. Document map

| Doc | Use when |
|---|---|
| **This file (`SWING-SYSTEM.md`)** | Understand the whole system in production terms |
| `SWING-ENGINE.md` | Historical build plan, PR sequence, adversarial reconciliations |
| `SWING-CTO-AUDIT-2026-07-29.md` | Latest deep audit + open follow-ups |
| `FINDINGS.md` | Incident / bug ledger with evidence |
| `ONBOARDING.md` | Platform-wide geography |

---

*Last updated: 2026-07-29 — reflects go-live commit rails, phase-anchored discovery, seven-section serving, and management gates that depend on OCC + pinned underlying levels.*
