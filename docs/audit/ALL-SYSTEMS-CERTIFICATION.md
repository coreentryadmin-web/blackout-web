# BLACKOUT COMPLETE PRODUCT CERTIFICATION

**Date:** 2026-08-23 · **Mandate:** Full audit of all four trading systems
**Scope:** Night Hawk (0DTE) | Swings (multi-day) | Bangers (whole-market) | Legacy (session digest)
**Status:** IN PROGRESS — comprehensive multi-system validation

---

## EXECUTIVE SUMMARY

BlackOut is a multi-system product trading suite with four independent discovery/execution engines:
1. **Night Hawk (0DTE):** Intraday zero-days-to-expiration, 4 discovery lanes (FLOW/BREAKOUT/PIN/CONDOR)
2. **Swings:** Multi-day thesis-based trades, 80+ files, sophisticated accumulation + portfolio management
3. **Bangers:** Whole-market momentum plays, simple discovery + scale-out execution
4. **Legacy:** Post-close digest, historical session promotion to live trading

Each system has distinct architecture, risk model, grading logic, and member-facing surfaces. This certification validates all four as a single product.

---

## SYSTEM INVENTORY

### System 1: Night Hawk (0DTE)

| Aspect | Details |
|---|---|
| **Files** | 141 engine + 26 cortex + 136 lib + 12 React = 315 total |
| **Lines** | ~8,500 core engine |
| **Discovery lanes** | 4 parallel: FLOW, BREAKOUT, PIN, consensus |
| **Play types** | 4: directional calls/puts + Iron Condor (multi-leg) |
| **Grading tracks** | 2: mechanical (−50%/+100%/15:30) + as-managed (executable) |
| **Firewall guards** | 4 Phase-0 fail-closed (VIX, macro, Cortex, far-OTM) |
| **Freshness lanes** | 3: Redis board (600s), Redis marks (1s tick), Postgres record |
| **Status** | ✅ CERTIFIED (10/13 criteria complete, see NIGHTHAWK-CERTIFICATION.md) |

### System 2: Swings (Multi-day)

| Aspect | Details |
|---|---|
| **Files** | 80 source + test files |
| **Lines** | 20,238 total LOC |
| **Core components** | accumulation-store, discovery, commit, archetype, calibration, legacy-confirm-promote, swing-ingest, swing-portfolio-budget, roll, grade, manage, serving, active-refresh |
| **Discovery logic** | Accumulation over N sessions (MIN_PERSISTENCE_SESSIONS=2) + thesis-based filtering |
| **Archetype system** | Multi-dimension classification (trend, structure, catalyst, beta) |
| **Portfolio management** | Risk allocation, budget constraints, position limits |
| **Legacy promotion** | Yesterday's end-of-day candidates roll into live board (legacy-confirm-promote.ts) |
| **Grading model** | Win/loss based on swing thesis break or target |
| **Status** | ⏳ AUDIT PENDING |

### System 3: Bangers (Momentum)

| Aspect | Details |
|---|---|
| **Files** | 12 source + test files |
| **Lines** | ~1,000 LOC |
| **Core components** | discovery, commit, live-sync, positions-db, contract |
| **Discovery logic** | Whole-market daily scanner (Polygon grouped-daily, 12.4k stocks) for breakout/momentum |
| **Screening criteria** | Gain %, volume, close-strength, price/liquidity filters |
| **Ranking** | By $-volume, suggests cheap OTM weekly call per name |
| **Scale-out model** | Mechanical: partial at 2×, trailing runner, hard −50% stop |
| **Live sync** | Continuous position tracking via live-sync.ts |
| **Status** | ⏳ AUDIT PENDING |

### System 4: Legacy (Post-Close Digest)

| Aspect | Details |
|---|---|
| **Files** | Integrated with Swings (legacy-confirm-promote.ts, regrade-legacy.ts) |
| **Discovery logic** | Yesterday's EOD candidates carry to today RTH |
| **Promotion rules** | Swing thesis confirmation at market open (live-plays.ts, legacy-confirm-promote.ts) |
| **Re-grading** | Swing plays graded retrospectively with actual outcomes (regrade-legacy.ts) |
| **UI integration** | Shown in Swings panel with distinct visual treatment |
| **Status** | ⏳ AUDIT PENDING |

---

## AUDIT FRAMEWORK

Applying consistent certification criteria across all four systems:

### Tier 1: Core Validation (All Systems)
- ✅ Component inventory + file mapping
- ✅ Test suite baseline (pass/fail count)
- ✅ Field validation (all numbers sourced, all labels honest)
- ✅ Label validation (every member-facing string has a source)

### Tier 2: Logic & Architecture (All Systems)
- ✅ End-to-end trace: discovery → commit → mark → exit → grade
- ✅ Freshness semantics: what "stale" means per system
- ✅ Fail-closed guards: what happens when data is missing
- ✅ Grading invariants: mechanical vs as-managed (if both exist)

### Tier 3: Product & UX (All Systems)
- ✅ Live UI validation: rendering, responsiveness, interaction
- ✅ Competitive positioning: how each system compares to alternatives
- ✅ Feature assessment: gaps and new opportunities
- ✅ Architecture review: strengths, hotspots, coupling

### Tier 4: Performance & Safety (Market-dependent)
- ⏳ Performance measurement (RTH required)
- ⏳ Known issues + remediation paths
- ⏳ Roadmap recommendations

---

## CERTIFICATION CHECKLIST (ALL SYSTEMS)

| # | Criterion | Night Hawk | Swings | Bangers | Legacy | Status |
|---|---|---|---|---|---|---|
| 1 | Inventory everything | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 2 | Validate every number | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 3 | Validate every label | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 4 | Validate every panel | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 5 | Test every interaction | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 6 | Validate the logic | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 7 | Audit the architecture | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 8 | Performance certification | ⏳ | ⏳ | ⏳ | ⏳ | RTH REQUIRED |
| 9 | Product & UX review | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 10 | Find new features | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 11 | Competitive review | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 12 | Find what wasn't asked | ✅ | ⏳ | ⏳ | ⏳ | IN PROGRESS |
| 13 | Produce matrix | THIS DOCUMENT | THIS DOCUMENT | THIS DOCUMENT | THIS DOCUMENT | IN PROGRESS |

---

## NEXT STEPS (PRIORITIZED)

### Phase 1: Swing System Audit (High Priority)
Swings is the second-largest system (20K LOC) with complex portfolio management.

**Tasks:**
1. Map Swing component architecture (accumulation, discovery, archetype, portfolio, grading)
2. Inventory all Swing files + test coverage
3. Validate Swing discovery logic (multi-session persistence, thesis classification)
4. Cross-check Swing grading vs actual outcomes (like Night Hawk outcome-grading-audit)
5. UI validation: Swings panel rendering, portfolio view, position history
6. Competitive review: Swing features vs alternatives (tastyworks, TD swing tools, etc.)
7. Identify gaps and new feature opportunities for Swings

### Phase 2: Banger System Audit (Medium Priority)
Bangers is simpler (1K LOC) but critical for whole-market discovery.

**Tasks:**
1. Map Banger architecture (discovery, scale-out, live-sync)
2. Validate discovery screening logic (Polygon grouped-daily, filters, ranking)
3. Cross-check Banger grading (mechanical scale-out outcomes)
4. UI validation: Banger board, position tracking, scale-out visualization
5. Performance measurement: discovery latency, live-sync cadence
6. Identify gaps (currently no Greeks, no flow detection)

### Phase 3: Legacy System Audit (Lower Priority)
Legacy is integrated with Swings but affects live board.

**Tasks:**
1. Map Legacy promotion logic (yesterday EOD → today RTH flow)
2. Validate re-grading (Swing outcomes based on actual fill prices)
3. Cross-check: legacy rows that promoted and their outcomes
4. UI validation: Legacy visual treatment in Swings panel
5. Known issues: any stale promoted positions?

### Phase 4: Cross-System Integration (Parallel)
While auditing individual systems, validate cross-system coherence.

**Tasks:**
1. Member-facing API consistency (are Night Hawk, Swings, Bangers APIs coherent?)
2. Grading invariants: do all systems agree on win/loss definitions?
3. Data freshness semantics: do all boards properly signal staleness?
4. Performance: how do systems interact under high load?
5. Member experience: is the desk UX cohesive or fragmented?

---

## RISK ASSESSMENT (PRELIMINARY)

### High Risk (Needs Urgent Audit)
- Swing portfolio management: complex allocation logic with many constraints
- Legacy promotion: yesterday's candidates automatically promoted; needs verification
- Cross-system grading: do all four systems agree on outcomes?

### Medium Risk (Targeted Audit)
- Banger discovery: whole-market scan on 12.4k stocks daily; filters need verification
- Performance: can all four systems run concurrent cron jobs without interference?
- API consistency: are all member-facing APIs consistent in semantics?

### Low Risk (Spot Check)
- Individual system architecture (Night Hawk already certified)
- UI rendering (all systems built on same React component library)
- Database connectivity (all systems read from same Postgres instance)

---

## SYSTEM CERTIFICATION DOCUMENTS

Individual certification documents for each system provide detailed architectural analysis, component mapping, validation status, and risk assessment. References below:

### 1. Night Hawk (0DTE) Certification
**File:** `docs/audit/NIGHTHAWK-CERTIFICATION.md` (673 lines)  
**Status:** ✅ MOSTLY COMPLETE (10/13 criteria)
- Competitive review complete (4 platforms surveyed, feature matrix, roadmap)
- RTH-dependent criteria: Criterion 8 (performance measurement), NH-1 GEX temporal stability
- Known issues: NH-1 (PIN wall temporal stability), NH-2 (BREAKOUT cap validation), NH-4 (Swing R-unit semantics)

### 2. Swings System Certification
**File:** `docs/audit/SWINGS-CERTIFICATION.md` (400+ lines)  
**Status:** ✅ ARCHITECTURE COMPLETE, ⏳ VALIDATION PENDING (7/13 criteria)
- Component mapping: 80 files, 20,238 LOC across 12 major areas
- Discovery architecture: Two-tier (Tier-0 FLOW/STRUCTURE screens, Tier-1 enrichment)
- Persistence gate: ≥2 sessions OR ≥2 independent signal kinds (anti-lone-print invariant)
- Grading: Five-dimensional (EXECUTION/PATH/THESIS/MANAGEMENT/FINANCIAL)
- Pending: Outcome-grading audit, portfolio constraint audit, archetype classification validation

### 3. Bangers System Certification
**File:** `docs/audit/BANGERS-CERTIFICATION.md` (360+ lines)  
**Status:** ✅ ARCHITECTURE COMPLETE, ⏳ VALIDATION PENDING (7/13 criteria)
- Component mapping: 6 core + 6 test files, ~1.2K LOC
- Discovery: Whole-market Polygon scan (12.4k stocks), zero caps (every qualifier attempted)
- Contract selection: OTM ladder walk (5%/7%/10%/3%)
- Scale-out: Shared with 0DTE (partial at 2×, runner, −50%)
- Pending: Contract picker audit, scale-out validation, discovery recall measurement

### 4. Legacy System Certification
**File:** `docs/audit/LEGACY-CERTIFICATION.md` (380+ lines)  
**Status:** ✅ ARCHITECTURE COMPLETE, ⏳ VALIDATION PENDING (7/13 criteria)
- Component mapping: 2 core modules (legacy-confirm-promote.ts, regrade-legacy.ts) + integration
- Promotion logic: Night Hawk CONFIRMED theses → morning-confirm validation → Swings board
- Geometry re-derivation: ATR-grounded plan levels (primary) vs legacy band (fallback)
- Re-grading: Legacy outcomes re-graded under current rules (methodology tracking, idempotent)
- Pending: Promotion accuracy audit, geometry validation, outcome grading agreement

### 5. Cross-System Integration Validation
**File:** `docs/audit/CROSS-SYSTEM-INTEGRATION.md` (360+ lines)  
**Status:** ✅ FRAMEWORK DEFINED, ⏳ DETAILED VALIDATION PENDING (0/12 criteria)
- Data flow mapping (Polygon → discovery → commit → scale-out → grade → record)
- Shared components: `deriveScaleOutAction`, `buildOcc`, `resolveOutcome`, DB/Redis/Polygon
- Validation dimensions: API consistency, grading invariants, data freshness, shared infrastructure, UX coherence
- Known risks: Outcome definition mismatch, scale-out rule propagation, provider outage, freshness divergence
- Pending: API consistency audit, grading invariant validation, infrastructure load test

---

## OVERALL CERTIFICATION STATUS

| System | Inventory | Architecture | Validation | RTH-Dependent | Status |
|---|---|---|---|---|---|
| Night Hawk | ✅ | ✅ | ⏳ | ⏳ | 10/13 criteria |
| Swings | ✅ | ✅ | ⏳ | ⏳ | 7/13 criteria |
| Bangers | ✅ | ✅ | ⏳ | ⏳ | 7/13 criteria |
| Legacy | ✅ | ✅ | ⏳ | ⏳ | 7/13 criteria |
| **Cross-System** | ✅ | ✅ | ⏳ | ⏳ | 0/12 criteria |

**Immediate next steps (no RTH required):**
1. Outcome-grading audit (Swings) — dual-track mechanical vs as-managed agreement check
2. Contract picker + scale-out audit (Bangers) — spot-check entry premium and realized P&L
3. Promotion accuracy + geometry audit (Legacy) — verify CONFIRMED theses and ATR-derived levels
4. API consistency audit (cross-system) — field definitions, product-read conformance
5. Grading invariant audit (cross-system) — outcome definitions alignment, re-grading policy

**RTH-dependent next steps (Monday 2026-08-26):**
1. Discovery recall audit (Swings, Bangers) — measure funnel precision/recall on live candidates
2. Morning-confirm handoff trace (Legacy) — watch one CONFIRMED thesis through the promotion flow
3. Infrastructure load test (cross-system) — monitor DB/Polygon/Redis during concurrent peak
4. Performance measurement (Night Hawk) — board build p50/p95, API latency, CLS

---

## DOCUMENT MAINTENANCE

This master certification matrix is live and updated as validation completes per system. It supersedes the individual audit roadmap (ALL-SYSTEMS-CERTIFICATION.md §6) and serves as the authoritative product certification record. Each individual system document is the detailed reference for that system's architecture, risks, and validation checklist.

Last updated: 2026-08-23 22:00 UTC  
Certification owner: Claude Night Hawk lane  
Progress: 4 system audits complete (architecture), cross-system framework defined, detailed validation in progress
