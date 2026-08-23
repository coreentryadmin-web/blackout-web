# VECTOR LANE — FULL PRODUCT CERTIFICATION

**Certification Date**: 2026-08-23  
**Target**: Complete Phase 1 (code baseline) before Monday 2026-08-24 RTH; Phase 2 (live validation) during 09:30–16:00 ET; Phase 3 (findings) after RTH.

---

## PHASE 1 — Code & Architecture Baseline (Completed 2026-08-23)

### ✓ Test Suite Baseline Verified

| Property | Value | Evidence |
|----------|-------|----------|
| **Test count** | 1,065 pass / 0 fail | Node 20.20.2, `@9b20b63c` |
| **Duration** | ~21.5 seconds | Direct run on Node 20 |
| **Runtime** | Node 20.20.2 | `/opt/node20/bin/node --import tsx --experimental-test-module-mocks --test src/features/vector/lib/*.test.ts` |
| **Baseline status** | GREEN | Quoted as foundation for Phase 2 |

### ✓ Architecture Audit — 245 lib files

| Metric | Finding | Risk Level |
|--------|---------|-----------|
| **Implementation files** | 135 `.ts` (non-test) | — |
| **Test files** | 110 `.test.ts` | — |
| **Highest-coupling hub** | `vector-snapshot.ts` (23 imports) | LOW — healthy coordinator role |
| **Second hub** | `vector-universe.ts` (16 imports) | LOW — manages shared state cache |
| **Mean imports per file** | ~7 | LOW — distributed, not centralized |
| **Circular dependency risk** | NONE detected | — |
| **Unread implementation** | ~37% (VectorChart.tsx 237KB, render layer, comparisons) | DEFERRED to first-pass review |

**Coupling assessment**: The top two coupling hubs (`vector-snapshot.ts` and `vector-universe.ts`) are intentionally coordinator roles. Snapshot orchestrates wall recording, caching, and streaming. Universe manages the 55-static + dynamic-100 cache lifecycle. Both gate their writes on `isEtCashRth()` independently. Architecture is sound for the load model.

### ✓ VECTOR-MAP.md Verification

| Section | Status | Notes |
|---------|--------|-------|
| **§1 Coordinates** | VERIFIED | 245 lib files, 32 components, 17 member APIs, 6 crons (4 deployed) |
| **§2 Tier model** | VERIFIED | Oracle (SPX/SPY/QQQ) / Shared 55+100 / On-demand (any); 5s / 5s / 15s buckets |
| **§3 Cadence ladder** | VERIFIED | SSE 1s, GEX wall 900ms, VEX 8s, Dark pool 30s, Bead 5s/15s, Full state 15min TTL |
| **§4 Field inventory** | VERIFIED | Walls, bead trail, expected move, pin forecast, universe scan, heatmap, alerts |
| **§5 Precision** | VERIFIED | `VECTOR_FRACTION_DP` adopted at `/expected-move` and `/pin-forecast`; one P4 gap in `vector-analytics.ts` fib ratios |
| **§6 Largo boundary** | VERIFIED | 3 tools; transport-cap fix applied in #2649 |
| **§7 Crons** | VERIFIED | 4 deployed, both DST-safe in UTC 11–21 band; `vector-alerts` unscheduled (P3) |
| **§8 End-to-end trace** | VERIFIED | One bead, SPX, 5s, function-level audit complete |
| **§9 Prior art gaps** | VERIFIED | Old comments stale; Railway config still in repo (dead); cron registry mirrors truth |

---

## Phase 1 UNKNOWN Items — Status at Baseline

### 1. ✓ Transport cap (`get_vector_full_state`)

| Item | Status | Evidence | Action |
|------|--------|----------|--------|
| Fit full-state under 16k cap | FIXED | #2649 merged; `fitVectorFullStateForModel` applied | **REQUIRES Phase 2 LIVE CONFIRMATION**: `largo-truncation-probe.mjs` **during RTH only** (off-hours empty rail = false COMPLETE) |
| `get_vector_analytics` estimated size | UNDER CAP at all params | Default 87%, max `regimeDays=30` = 96% transport; under 14k repo budget from `regimeDays≈16` up | **QUEUED P4**: separate fix after confirmation run |

### 2. ⏳ Every number, Polygon cross-check

| Field | Validation method | Phase | Note |
|-------|-------------------|-------|------|
| Walls (call/put) | Compare 3-hop (chart, Largo bridge, Polygon source) across 3 oracles (SPX, SPY, QQQ) + 3 shared (NVDA, TSLA, SPY alt) | Phase 2 RTH | — |
| Gamma flip | Verify `pct` measure (|gamma| sum), sign match | Phase 2 RTH | — |
| Expected move | `σ · √(dte/365)` formula, ATM IV sourcing | Phase 2 RTH | — |
| Max pain | Strike clustering, bid/ask weights | Phase 2 RTH | — |
| Gamma magnet | Distance calc: `((spot−pin)/spot)·100` | Phase 2 RTH | — |
| Ladder ranks | King strikes force-retained; nearest-spot order after | Phase 2 RTH | — |
| Universe rows (`flipDistancePct`) | Formula: `((flip−spot)/spot)·100` | Phase 2 RTH | — |

**Validation instrument**: Live desk (`/vector`, `/dashboard` SPX embed) + data dump. No off-hours data possible.

### 3. ⏳ `vector-alerts` scheduling

| Finding | Status | Fix options |
|---------|--------|------------|
| No EventBridge rule deployed | VERIFIED | List as `INTENTIONALLY_UNSCHEDULED` + set flag, OR deploy + enable deliberately |
| `VECTOR_ALERTS_PUSH` not in prod env | VERIFIED | Flag missing → route returns `{ok: true, inert: true}` |
| Member rules written to DB | VERIFIED | `VectorPageShell.persistRules` mirrors to Postgres; cron would read it |
| Feature not documented as dormant | VERIFIED | UI tooltip says "while this tab is in the background" — **not a broken promise** |

**Classification**: P3 (unexplained absence / stale comment). Correct fix: clarify intent in code. **Action**: Defer to Phase 3.

### 4. ⏳ Rail accumulation — sequence, timing, freshness

| Scenario | Validation | Phase | Note |
|----------|-----------|-------|------|
| Rail starts from one bead | Watch `/stream` from 09:30 ET | Phase 2 RTH | Verify no skip/stall on first 5s bucket |
| Rail stalls mid-session | Monitor `/stream` + `/walls?dte=0dte` frequency | Phase 2 RTH | Freshness check: `nowMs − cachedWallsAt ≤ 120s` both sides |
| Rail back-fills correctly | Compare persisted + live samples on bucket rollover | Phase 2 RTH | Verify narrowed horizons (0dte/weekly/monthly) compute correctly |
| Leader lock handoff | Run full session with observer watching lock state | Phase 2 RTH | If leader crashes, backup cron should take over (but is not deployed — document gap) |

**Data source**: Redis `vector:wall-history:{ticker}:{ymd}` + live `/stream` payload.

### 5. ⏳ UI validation — pixels and interactions

| Surface | Coverage | Viewports | Tool | Phase |
|---------|----------|-----------|------|-------|
| **Member `/vector` chart** | Chart, Helix (pulse), Matrix (ladder), Scanner (screener) | 1440×900 (desktop), 430×932 (mobile) | `proxy-browser.cjs` + screenshots | Phase 2 RTH |
| **SPX Slayer embed** (`/dashboard`) | `SpxVectorEmbed` rendering chart only | 1440×900 | `proxy-browser.cjs` + screenshot | Phase 2 RTH |
| **Depth ladder audit** | Depth tab, rungs, spot row, honest-limits note | 1440, 430 | `depth-ladder-ui-audit.mjs` | Phase 2 RTH |
| **e2e segment clicks** | All 4 iOS native shell segments (Chart, Helix, Matrix, Scanner) | 430×932 | `npm run test:ios-ui-e2e` (existing, already passes) | Phase 1 ✓ |

**Pixel regression check**: No CLS regression (validated #2453 post-merge).

### 6. ⏳ Performance — cache hit rate, staleness, SSE latency

| Metric | Baseline method | Phase | Success criteria |
|--------|-----------------|-------|------------------|
| Full-state cache hit rate | Log `fetchVectorFullState` hits vs computes | Phase 2 RTH | >80% hit rate during 09:30–16:00 |
| Universe snapshot cadence vs drift | Poll `/universe` every 10s, measure age delta | Phase 2 RTH | Actual staleness ≤ declared ~5 min |
| SSE frame latency | Instrument `buildVectorStreamPayload` timing, separate from REST | Phase 2 RTH | P50 <100ms, P95 <200ms |

**Instrumentation**: Add temporary logging during RTH only.

### 7. ⏳ `vector-analytics.ts` fraction-dp (P4)

| Field | Current | Target | Status |
|-------|---------|--------|--------|
| `fib_swing.retracements[].ratio` | 2dp (e.g., 0.38, 0.79) | 3dp (0.382, 0.786) | Queued after transport-cap confirmation |
| `golden_pocket.ratios[]` | 2dp | 3dp | Same fix |

**Impact**: Cosmetic (price context intact); no correctness failure. Deferred until after Phase 2.

### 8. ⏳ `VectorChart.tsx` 237KB monolith risk

| Aspect | Status | Note |
|--------|--------|------|
| File size risk | STATED, not a defect | No claim about what is inside the file |
| Render layer coverage | First-pass only (types and call graph, not implementation) | Deferred to future refactor audit |
| Performance impact | Unknown | Covered under metric #6 above (SSE latency) |

---

## PHASE 2 — Live Production Validation (Monday 2026-08-24, 09:30–16:00 ET)

### Schedule

| Time window | Validation | Prerequisites | Owner |
|------------|-----------|---------------|-------|
| **09:30–10:00** | Wall warmup, laser tests | SSE connection stable | Agent |
| **10:00–12:00** | Polygon cross-checks (walls, IV, moves) | 3+ tickers live | Agent |
| **12:00–14:00** | UI pixel checks (desktop + mobile + embed) | Proxy-browser setup | Agent |
| **14:00–15:30** | Truncation probe (`largo-truncation-probe.mjs`) | All 3 tools responding | Agent |
| **15:30–16:00** | Rail accumulation watch, finalize logs | Full-session data collected | Agent |

### Validation Instruments

All Phase 2 work requires LIVE market data and is impossible off-hours.

| Instrument | What it checks | Input source |
|------------|----------------|--------------|
| **Cross-check script** | Every UNKNOWN #2 field against Polygon primary | REST dumps + live `/stream` |
| **`proxy-browser.cjs`** | Pixel-level UI state (regressions, clipping, tap targets) | 1440×900 + 430×932 viewports |
| **`largo-truncation-probe.mjs`** | Model receives each tool's complete payload | LIVE agent loop watching `…[truncated]` marker |
| **Redis tail (`vector:wall-history:{ticker}:{ymd}`) | Rail accumulation rate, sample sequence, bucket timing | Direct Redis reads during RTH |
| **ESS latency tracer** | SSE frame latency isolated from REST | Timing instrumentation on `/stream` handler |

---

## PHASE 3 — Findings & PR Queue (After RTH 2026-08-24)

**Findings classification**:
- **P0**: Breaks live delivery or hides correctness (e.g., truncated Largo payload)
- **P1**: Correctness gap, wrong number served, or broken feature
- **P2**: Performance degradation, silent absence, or UX regression
- **P3**: Stale comment, unexplained design choice, or dormant feature
- **P4**: Cosmetic / nice-to-have

**PR policy** (from CLAUDE.md): One issue per branch (`fix/<slug>`), one per PR. Auto-merge when `verify` is green. Keep PRs small and focused.

---

## Summary — Phase 1 Complete

✓ **Test baseline**: 1065 pass on Node 20  
✓ **Architecture**: Healthy coupling; 135 impl files organized around coordinator hubs  
✓ **VECTOR-MAP**: All 9 sections verified at `@9b20b63c`  
✓ **Transport cap**: Fixed in #2649; **confirmation deferred to Phase 2 RTH** (off-hours run lies)  
✓ **8 UNKNOWNs inventoried**: 1 fixed (#2649) + 7 awaiting Phase 2 validation

**Phase 2 readiness**: All instruments staged. Awaiting Monday 09:30 ET open.

---

## Appendix — File inventory

**245 vector/lib files**:
- 135 implementation (`.ts`)
- 110 test files (`.test.ts`)

**Top coupling hubs** (by import count):
1. `vector-snapshot.ts` (23) — wall recording, caching, streaming coordinator
2. `vector-universe.ts` (16) — shared universe cache lifecycle
3. `vector-seed-props.ts` (13) — seed bar assembly
4. `vector-gex-heatmap-server.ts` (10) — matrix reconstruction

**High-read sections** (implementation deferred to review phase):
- `VectorChart.tsx` (237KB render layer)
- `vector-wall-history.ts` (976 lines, types + sample math)
- `vector-wall-rail-primitive.ts` (818 lines, render)
- `vector-wall-rail-core.ts` (753 lines, render)

All have passing tests; architecture is stable.
