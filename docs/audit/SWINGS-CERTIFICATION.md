# SWINGS SYSTEM CERTIFICATION

**Date:** 2026-08-23 · **System:** Multi-day thesis-based trading
**Status:** AUDIT IN PROGRESS — architectural analysis complete, detailed validation pending
**Files:** 80 source + test | **Lines:** 20,238 LOC

---

## EXECUTIVE SUMMARY

Swings is BlackOut's multi-day, thesis-driven trading system. Unlike Night Hawk's intraday 0DTE discovery, Swings surfaces candidates that PERSIST across ≥2 sessions (or meet corroboration criteria) and manages them through a sophisticated portfolio allocation engine. 

**Key architectural characteristics:**
- Two-tier discovery: Tier-0 screens (FLOW, STRUCTURE) → Tier-1 enrichment (dossier, scoring)
- Multi-dimensional archetype classification (7+ archetypes: BREAKOUT, PULLBACK_CONTINUATION, MEAN_REVERSION, etc.)
- Cross-session persistence memory: thesis identity = (ticker, direction, archetype)
- Five-dimensional grading: EXECUTION, PATH, THESIS, MANAGEMENT, FINANCIAL
- Portfolio budget constraints: allocation, position limits, risk management
- Legacy promotion: yesterday's EOD candidates roll into today's live board

---

## 1. COMPONENT INVENTORY

### Core Discovery & Classification (8 files, ~3,300 LOC)

| Component | File | Lines | Purpose |
|---|---|---|---|
| Discovery orchestration | discovery.ts | 574 | Two-tier whole-market scan (FLOW + STRUCTURE screens), tier-1 enrichment, persistence gating |
| Archetype classifier | archetype.ts | 412 | Single-winner classification (7+ archetypes), confidence scoring, null-when-thin guard |
| Accumulation memory | accumulation-store.ts | 437 | Cross-session persistence store, anti-lone-print invariant, signal-kind corroboration |
| Dossier builder | dossier.ts | 220 | Multi-day reads assembly, pillar scoring, directional signals |
| Entry model | entry-model.ts | 180 | Entry contract selection (ATM put, OTM spread), premium capture |
| Taxonomy | taxonomy.ts | 302 | Archetype definitions, persistence rules, tier selection |
| Swing signals | ../swing-signals.ts | 180 | Direction-signed reads foundation (volatility, price action, accumulation) |
| Portfolio budget | swing-portfolio-budget.ts | 297 | Risk allocation, position limits, budget constraints |

**Key insight:** Discovery is persistence-gated (≥2 sessions or ≥2 independent signals). A "thesis" = (ticker + direction + archetype), ensuring a MEAN_REVERSION on NVDA doesn't share persistence with a BREAKOUT on the same name.

### Commit & Execution (2 files, ~650 LOC)

| Component | File | Lines | Purpose |
|---|---|---|---|
| Commit logic | commit.ts | 613 | Tier selection, contract planning, position sizing, atomic DB insert |
| Live sync | ../banger/live-sync.ts | 142 | Continuous position tracking, P&L refresh |

### Grading & Outcome Tracking (2 files, ~700 LOC)

| Component | File | Lines | Purpose |
|---|---|---|---|
| Grading engine | grade.ts | 418 | Five-dimensional grading (EXECUTION/PATH/THESIS/MANAGEMENT/FINANCIAL), outcome classification |
| Re-grading (legacy) | ../regrade-legacy.ts | 180 | Retrospective grading of yesterday's promoted candidates with actual outcomes |

### Portfolio & Risk Management (8 files, ~1,500 LOC)

| Component | File | Lines | Purpose |
|---|---|---|---|
| Archetype allocation | swing-allocation.ts | 250 | Per-archetype budget allocation |
| Portfolio management | manage.ts | 360 | Active position tracking, allocation enforcement, constraint checking |
| Manage sync | manage-sync.ts | 550 | Reconciliation between trades and position ledger |
| Risk modeling | swing-risk.ts | 175 | Position delta/Greeks, margin requirements |
| Catalyst analysis | swing-catalyst.ts | 330 | Event-driven archetype scoring, earnings/macro impact |
| Roll management | roll.ts + roll-plan.ts | 335 | Contract roll logic (exiting when approaching exp) |
| Active refresh | active-refresh.ts | 140 | EOD snapshot refresh for next-day promotion |
| Event trigger | event-trigger.ts | 260 | Session event routing, thesis progress updates |

### Serving & API (5 files, ~400 LOC)

| Component | File | Lines | Purpose |
|---|---|---|---|
| Serving orchestration | serving.ts | 345 | Board assembly, member-facing play shapes |
| Serving lane | serving-lane.ts | 360 | Per-horizon grouping (TACTICAL/STANDARD/EXTENDED) |
| Serving ingest | serving-ingest.ts | 245 | Live mark ingestion, board refresh |

### Testing (41 test files, full parity)

Every core component has a `.test.ts` file with unit tests. Test coverage is comprehensive with detailed assertions on archetype classification, persistence logic, grading outcomes, allocation constraints.

---

## 2. DISCOVERY ARCHITECTURE DEEP DIVE

### Tier-0: Whole-Market Screens

**FLOW Screen:**
- Multi-day accumulation over 120h window
- Identifies directional stacked positioning (Unusual Whales flow)
- Returns names with directional conviction persistence
- Can be null (name has no flow history)

**STRUCTURE Screen:**
- Daily breakout movers (Polygon grouped-daily, ~12.4k stocks)
- Closed-strong, high-volume breakout candidates
- Momentum/reversal candidates from price action
- Identifies structure-driven, flow-agnostic candidates

**Merge & Ranking:**
- Union the two screens (name appears on both = corroborated, ranked first)
- Structure-only name with NO flow still passes (carries null accumulation read, produces dossier without FLOW pillar) — this is FM#1 design: never drop a candidate solely because it lacks flow
- Tier-1 budget cap (load-bearing leak): `cappedOut` count made visible

### Tier-1: Per-Name Enrichment

**Dossier Assembly:**
1. Fetch multi-day bars, volatility, relative strength, catalyst reads
2. Run `scoreSwingPillars` (8 pillars):
   - Trend strength (EMA stack, consistency)
   - Structure (breakout/support, range geometry)
   - Accumulation (flow persistence)
   - Catalyst (earnings, events, sector rotation)
   - Beta (correlation to index, relative strength)
   - Risk (liquidity, volatility bands, margin)
   - Event (macro, economic, sector rotation)
   - Industry group RS (relative to own sector, not SPY)
3. Produce horizon plays (direction, tier, entry contract)

**Archetype Classification:**
1. Score each of 7+ archetypes (0–1 fit, or null if ungrounded)
2. Tie-break on ARCHETYPE_PRIORITY (EVENT_DRIVEN > BREAKOUT > PULLBACK_CONTINUATION > ...)
3. Null-when-thin guard: if no fit clears minimum evidence floor, verdict = null
4. DIRECTION SYMMETRY: SHORT mirrors LONG due to signed reads

### Persistence Gate (Critical Design)

| Archetype | Persistence Rule | Rationale |
|---|---|---|
| BREAKOUT | ≥2 sessions | Build across days |
| PULLBACK_CONTINUATION | ≥2 sessions | Trend establishment needs time |
| MEAN_REVERSION | ≥2 sessions | Needs confirmation bounce |
| FLOW_ACCUMULATION | ≥2 sessions | Multi-day stacking |
| EVENT_DRIVEN | ≥2 independent signals OR ≥1 session | Event is immediate; needs corroboration |
| POST_EARNINGS_DRIFT | ≥2 independent signals OR ≥1 session | Actionable within print day |
| FAILED_BREAKDOWN | ≥2 independent signals OR ≥1 session | Reversal signals are immediate |

**Anti-Lone-Print Invariant:**
- A lone sighting (one observation, one signal kind, one session) NEVER promotes for ANY archetype
- Signal kind = screen provenance (FLOW / STRUCTURE / CATALYST), NOT cadence phase
- Example: FLOW print at POST_CLOSE + FLOW again at MIDDAY = ONE signal kind, needs a second signal kind OR a second session

---

## 3. GRADING ARCHITECTURE

### Five Dimensions of Swing Grading

1. **EXECUTION:** Entry timing, contract selection, fill quality
2. **PATH:** Trade path vs thesis direction (did the move confirm?)
3. **THESIS:** Thesis itself (breakout holds, reversal bounces, etc.)
4. **MANAGEMENT:** Exit discipline, position sizing, roll execution
5. **FINANCIAL:** Dollar P&L, ROI on capital, risk-adjusted return

### Outcome Classification

| Outcome | Meaning |
|---|---|
| WIN | Thesis confirmed + position scaled out profitably |
| LOSS | Thesis break OR time decay closed position for loss |
| BREAKEVEN | Minor P&L (<10bps) or partial realization |
| MANAGED | Partial banker, not full exit (open ratchet) |

### Dual Grading (Like Night Hawk)

- **Mechanical:** Position held to mechanical signal (support break, time decay, time stop)
- **As-Managed:** Position actual fill prices (entry contract real cost, exit real contract sale price)
- Both tracks graded independently, checked for 100% agreement (outcome-grading-audit)

### Legacy Re-grading

Yesterday's EOD candidates promoted to live board today. `regrade-legacy.ts` retroactively grades with actual outcomes:
- Entry premium captured (yesterday's snapshot)
- Exit: today's session-end prices (mechanical grade) OR member's actual fills (as-managed grade)
- Session outcome determines legacy row's final grade + P&L

---

## 4. PORTFOLIO MANAGEMENT

### Allocation Constraints

**Tier allocation:**
- TACTICAL (high-confidence): max 40% of portfolio
- STANDARD (medium-confidence): max 35%
- EXTENDED (lower-confidence): max 25%

**Archetype allocation:**
- Each archetype gets a % of portfolio based on historical win-rate
- Positions sized to respect margin, Greeks, correlation

**Position limits:**
- Max 15–20 active swings per member (tuned by tier)
- Max 2–3 per ticker (avoid concentration)
- Max Greeks exposure per portfolio

**Budget enforcement:**
- Every commit checks `swing-portfolio-budget.ts` constraints
- Reject commit if allocation violated (fail-closed)
- Live-sync continuously monitors, can flag imbalances

---

## 5. VALIDATION STATUS

### ✅ COMPLETED (Architectural)

- Component mapping (80 files, 20K LOC, well-organized)
- Discovery two-tier architecture documented
- Archetype classification system understood (7+ archetypes, priority tie-break)
- Persistence rules (≥2 sessions OR ≥2 signals, anti-lone-print invariant)
- Grading five-dimensional model (EXECUTION/PATH/THESIS/MANAGEMENT/FINANCIAL)
- Portfolio allocation constraints identified

### ⏳ PENDING (Detailed Validation)

| Item | Method | RTH Required |
|---|---|---|
| Discovery recall audit | Run discovery-recall-probe.mjs on live Swings candidates | Yes |
| Grading cross-check | Swing outcome-grading-audit: mechanical vs as-managed (like Night Hawk) | No |
| Portfolio constraint enforcement | Verify budget enforcement on live positions | No |
| Archetype classification accuracy | Audit sample of classified swings (do archetypes match reality?) | No |
| Legacy promotion & re-grading | Validate yesterday EOD → today RTH flow + outcome grading | Yes |
| Performance measurement | Board build time, commit latency, P&L update cadence | Yes |

---

## 6. KNOWN RISKS & OBSERVATIONS

### High Risk

1. **Persistence gate complexity:** (ticker, direction, archetype) PK is sophisticated; mutations (archetype flip mid-accumulation, signal-kind counting) need rigorous testing
2. **Legacy promotion:** Automatic roll of EOD candidates into live board; ensures no stale positions? Regrade logic correct?
3. **Archetype tie-breaks:** When BREAKOUT and PULLBACK_CONTINUATION both fit (e.g., pullback within breakout), does ARCHETYPE_PRIORITY deterministic tie-break hold?

### Medium Risk

1. **Discovery recall:** Is tier-1 budget cap (`cappedOut`) measured and monitored? (Like breakout dynamic-cap in Night Hawk)
2. **Portfolio drift:** Do constraints stay enforced intraday or can positions creep over limits?
3. **Event-driven corroboration:** Are "≥2 independent signals" correctly counted? (FLOW + STRUCTURE = 2 kinds; FLOW + FLOW = 1 kind)

### Low Risk

1. **Grading dimensions:** Five dimensions well-designed, dual-track (mechanical vs as-managed) same as Night Hawk
2. **Component isolation:** Discovery, commit, grading, serving well-separated; no known circular dependencies

---

## 7. NEXT AUDIT STEPS

### Immediate (No RTH)
1. **Outcome-grading audit for Swings:** Run same dual-track (mechanical vs as-managed) cross-check as Night Hawk
2. **Archetype classification audit:** Sample 20–30 live/historical swings, verify archetype assignment + confidence
3. **Portfolio constraint audit:** Verify all active swings respect tier/archetype/concentration limits
4. **Legacy re-grading audit:** Sample legacy promotions, verify outcome grading logic

### RTH-Dependent
1. **Discovery recall audit:** Run Swings equivalent of breakout-discovery-recall-probe (measure discovery funnel recall/precision)
2. **Live sync validation:** Monitor position tracking during live market
3. **Performance measurement:** Board build p50/p95, commit latency, P&L update cadence

---

## 8. ARCHITECTURAL ASSESSMENT

### Strengths
- **Sophisticated persistence logic:** Anti-lone-print invariant + archetype-aware rules prevent false signals
- **Direction symmetry:** SHORT mirrors LONG due to signed reads; no special-casing
- **Tier-0 diversity:** FLOW and STRUCTURE screens complementary; union approach (not intersection) maximizes recall
- **Portfolio constraints:** Risk allocation, position limits, Greeks management built-in
- **Five-dimensional grading:** Rich outcome taxonomy vs simple binary win/loss

### Complexity Hotspots
- **Accumulation store:** Thesis identity, signal-kind counting, corroboration logic (needs careful testing)
- **Archetype classification:** 7+ archetypes with overlapping signals; tie-break determinism critical
- **Legacy promotion:** Automatic roll + regrade; ensures correct carry-over + outcome grading?
- **Portfolio sync:** `manage-sync.ts` 550 LOC; reconciliation between trades and ledger must be bulletproof

---

## CERTIFICATION CHECKLIST (SWINGS)

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | Inventory everything | ✅ | 80 files, 20K LOC mapped; all components documented |
| 2 | Validate every number | ⏳ | Requires outcome-grading audit (dual-track like Night Hawk) |
| 3 | Validate every label | ⏳ | Archetype names, grade dimensions, outcome labels need verification |
| 4 | Validate every panel | ⏳ | Swings UI rendering + interaction audit (like Night Hawk) |
| 5 | Test every interaction | ⏳ | UI interaction audit pending (proxy-browser) |
| 6 | Validate the logic | ⏳ | Discovery, persistence, grading traces need end-to-end validation |
| 7 | Audit the architecture | ✅ | Architecture review complete; risks identified |
| 8 | Performance certification | ⏳ | RTH performance measurement pending |
| 9 | Product & UX review | ⏳ | Portfolio view, position history, roll management UX |
| 10 | Find new features | ⏳ | Gaps: no Greeks visualization, no live Greeks hedging |
| 11 | Competitive review | ⏳ | Compare Swings against TD Swing tools, other platforms |
| 12 | Find what wasn't asked | ⏳ | New features: Greeks visualization, roll automation, tax-lot tracking? |
| 13 | Produce matrix | THIS DOCUMENT | Swings certification section added |

---

**Last updated:** 2026-08-23 20:20 UTC  
**Certification owner:** Claude Night Hawk lane  
**Next step:** Run outcome-grading audit + portfolio constraint validation (no RTH needed)
