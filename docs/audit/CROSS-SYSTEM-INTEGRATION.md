# CROSS-SYSTEM INTEGRATION VALIDATION

**Date:** 2026-08-23 · **Scope:** All four trading systems (Night Hawk, Swings, Bangers, Legacy)  
**Status:** FRAMEWORK DEFINED — detailed validation pending  

---

## EXECUTIVE SUMMARY

BlackOut's four trading systems (Night Hawk, Swings, Bangers, Legacy) operate independently but share data, infrastructure, and grading rules. This document validates **cross-system coherence** — that they agree on outcomes, don't corrupt each other's data, and degrade gracefully under failure.

**Validation dimensions:**
1. **API Consistency:** Do all systems expose member-facing data in coherent formats?
2. **Grading Invariants:** Do all systems agree on win/loss/breakeven definitions?
3. **Data Freshness:** What does "stale" mean per system, and do staleness semantics align?
4. **Shared Infrastructure:** How do systems interact under high load (cron concurrency, DB pooling, cache)?
5. **Member Experience:** Is the desk UX cohesive or fragmented across the four lanes?

---

## 1. COMPONENT INTEGRATION POINTS

### Data Flows

```
                    Night Hawk (0DTE)
                  ↓        ↓        ↓
    Polygon/UW  FLOW   BREAKOUT   PIN  CONDOR
                  ↓        ↓        ↓        ↓
            [Discovery → Commit → Grade → Record]
                            ↓
                       Shared Scale-Out
                            ↓
              ┌─────────────┼─────────────┐
              ↓             ↓             ↓
          Bangers       Swings        Legacy
         (whole-market) (multi-day)   (overnight)
              ↓             ↓             ↓
         [Discovery] [Discovery]  [Promotion]
              ↓             ↓             ↓
         [Commit]     [Commit]      [Merge]
              ↓             ↓             ↓
         [Scale-Out]   [Scale-Out]  [Scale-Out]
              ↓             ↓             ↓
         [Grade]       [Grade]       [Grade]
              ↓             ↓             ↓
         [Record]      [Record]      [Record]
```

### Shared Components

| Component | Used By | Purpose | Coherence Risk |
|---|---|---|---|
| `deriveScaleOutAction` | 0DTE, Bangers, Swings, Legacy | Mechanical scale-out (partial at 2×, runner, −50%) | ALL systems use identical rules; if rules change, all must re-grade |
| `buildOcc` | 0DTE, Bangers, Swings | OCC symbol building | Low — pure utility, no ambiguity |
| `resolveOutcome` | 0DTE, Swings, Legacy | Outcome grading | ALL systems grade using identical rules; legacy rows carry old-methodology tags |
| `fetchStockDailyBars` | Swings, Bangers, Legacy | Multi-day bar fetches | Medium — cache/rate limits shared; outages affect multiple systems |
| Polygon API | 0DTE, Bangers, Swings, Legacy | Prices, chains, bars | HIGH RISK — single provider; if unavailable, all discovery stops |
| Redis board | 0DTE (Night Hawk), Swings | Serving snapshots, marks | Medium — 600s board cache, 1s mark cache; staleness gates coordination |
| Postgres (DB) | All systems | Persistent state (positions, plays, outcomes) | HIGH RISK — all systems write to same DB; pool exhaustion, lock contention |

---

## 2. VALIDATION CHECKLIST — API CONSISTENCY

### Member-Facing Data Structures

**Night Hawk (`GET /api/market/nighthawk/{horizon}`)**

```typescript
{
  board: Array<{
    ticker: string
    direction: "LONG" | "SHORT"
    entry_premium: number
    peak_premium: number | null
    last_mark: number | null
    status: "OPEN" | "PARTIAL" | "CLOSED_RUNNER" | "STOPPED" | "CLOSED_WIN" | "CLOSED_LOSS"
    discovery: { origin: "FLOW" | "BREAKOUT" | "PIN", confidence: number, ... }
    play_score: number
    execution_tier: "TACTICAL" | "STANDARD" | "EXTENDED"
    ...
  }>
}
```

**Swings (`GET /api/market/swings/{horizon}`)**

```typescript
{
  board: Array<{
    ticker: string
    direction: "LONG" | "SHORT"
    entry_premium: number | null  // Swing entries are underlying prices, not premiums
    peak_premium: number | null
    last_mark: number | null
    status: "OPEN" | "PARTIAL" | "CLOSED_RUNNER" | "STOPPED" | "WIN" | "LOSS"
    archetype: string
    play_score: number
    execution_tier: "TACTICAL" | "STANDARD" | "EXTENDED"
    ...
  }>
}
```

**Bangers (`GET /api/market/bangers/{horizon}` — if exposed)**

```typescript
{
  board: Array<{
    ticker: string
    direction: "LONG"  // Bangers are always calls (long premium)
    entry_premium: number
    peak_premium: number | null
    last_mark: number | null
    status: "OPEN" | "PARTIAL" | "CLOSED_RUNNER" | "STOPPED"
    discovery: { gain: number, volume: number, close_strength: number, ... }
    ...
  }>
}
```

**COHERENCE CHECKS:**

1. ✅ Status values: Are they defined consistently across all systems?
   - Night Hawk uses: OPEN, PARTIAL, CLOSED_RUNNER, STOPPED, CLOSED_WIN, CLOSED_LOSS
   - Swings uses: OPEN, PARTIAL, CLOSED_RUNNER, STOPPED, WIN, LOSS
   - Bangers uses: OPEN, PARTIAL, CLOSED_RUNNER, STOPPED
   - ⚠️ **RISK:** Swings/Bangers have no CLOSED_WIN/CLOSED_LOSS; grading outcome is inferred from realized P&L sign
   - ⚠️ **RISK:** Night Hawk has CLOSED_WIN/CLOSED_LOSS as explicit status; Swings/Bangers do not

2. ✅ Entry premium semantics:
   - Night Hawk: `entry_premium` = option premium paid
   - Swings: `entry_premium` = underlying price of entry (not a premium; Swing entries are underlying price, not option contracts)
   - Bangers: `entry_premium` = option premium paid (same as 0DTE)
   - ⚠️ **RISK:** Swings conflates "entry premium" with "underlying entry price" — name is misleading

3. ⚠️ Peak premium handling:
   - 0DTE: peak_premium = highest option premium reached
   - Swings: peak_premium = highest underlying price (or highest option mark if entered as call/put?)
   - Bangers: peak_premium = highest option mark
   - **NEED CLARIFICATION:** Do Swings positions track underlying peak or option contract peak?

4. ⚠️ Execution tier:
   - Defined consistently across all systems? (TACTICAL, STANDARD, EXTENDED)
   - Tier allocation constraints enforced per system?
   - Can a member's TACTICAL allocation be exhausted by Bangers, leaving Swings TACTICAL slots empty? (Cross-system budget enforcement?)

### Recommendation

- **Define a unified position schema** in `src/lib/largo/contract/product-read.ts` (or similar) that all systems conform to
- **Map system-specific fields** (archetype, origin, discovery reads) into product-read envelope
- **Clarify entry semantics:** Is entry_premium a premium (0DTE, Bangers) or a price (Swings)?

---

## 3. VALIDATION CHECKLIST — GRADING INVARIANTS

### Outcome Definitions

**Night Hawk:**
- **target:** Close ≥ target OR (entry band touched AND reached target)
- **stop:** Low ≤ stop
- **open:** Neither target nor stop; position still in thesis band at session close
- **unfilled:** Entry band never touched (gapped away)
- **ambiguous:** Both target and stop hit in same bar (rare edge case)
- **Dual-track grading:** Mechanical (mid-plan) vs as-managed (executable)
- **Mechanical rule:** −50% hard stop at open

**Swings:**
- **WIN:** Thesis confirmed + position scaled out profitably
- **LOSS:** Thesis break OR time decay closed position for loss
- **BREAKEVEN:** Minor P&L (<10 bps) or partial realization
- **MANAGED:** Partial banker, not full exit (open ratchet)
- **Dual-track grading:** Mechanical (signal-based) vs as-managed (actual fills)

**Bangers:**
- Graded via shared `deriveScaleOutAction` state machine
- **Scale-out outcomes:** TAKE_PARTIAL (2×), EXIT_RUNNER (trailing), STOP_OUT (−50%)
- Realized P&L: partial tranche + remaining tranche at exit
- **Single-track grading:** Mechanical (no as-managed alternative)

**Legacy (0DTE):**
- Uses 0DTE's `resolveOutcome` rules (target/stop/open/unfilled/ambiguous)
- **Re-grading:** When 0DTE rules change, legacy rows re-graded under new rules
- Old methodology preserved in `legacy_grade` column (first-write-wins)

**COHERENCE CHECKS:**

1. ⚠️ **Are win/loss definitions aligned?**
   - Night Hawk: "target hit" = win
   - Swings: "thesis confirmed + scaled profitably" = win (different gate)
   - Bangers: No explicit "win" status; realized P&L sign inferred
   - **RISK:** A 0DTE position that hits target may close with −5% realized P&L if entry was poor; is that a win or loss?

2. ⚠️ **Dual-track vs single-track:**
   - 0DTE has mechanical + as-managed; Swings has both; Bangers has only mechanical
   - **RISK:** Comparing win-rates across systems conflates different tracking methods
   - **REQUIREMENT:** outcome-grading-audit.mjs verifies 0DTE mechanical vs as-managed agreement; Swings needs same check

3. ⚠️ **Legacy outcome drift:**
   - When 0DTE rules change (e.g., fillability re-assessment), legacy rows are re-graded
   - **QUESTION:** Is there a process to re-grade Swings/Bangers outcomes when shared scale-out rules change?

### Recommendation

- **Verify mechanical vs as-managed agreement** for Swings (same audit as 0DTE)
- **Define re-grading policy:** When scale-out rules change, which systems are re-graded?
- **Establish cross-system outcome audit:** Compare outcomes on positions with identical entry/exit rules

---

## 4. VALIDATION CHECKLIST — DATA FRESHNESS & STALENESS

### Freshness Semantics Per System

**Night Hawk (0DTE):**
- Board snapshot: Redis 600s max staleness (per cron interval)
- Live marks: Redis 1s tick (1-second freshness)
- Stale gate: `discovery_health` field; set to "QUIET" when the market is stale (VP flow unavailable, no 0DTE chains, etc.)
- **Fail-closed:** VIX unavailable → Phase-0 firewall blocks discovery

**Swings (multi-day):**
- Board snapshot: Redis per cron (discovery runs once daily at session open)
- Marks: Polygon daily OHLC (once per day, not ticked)
- Stale gate: No explicit "quiet market" signal; relies on accumulation-store silence
- **Fail-soft:** Thin data simply reduces score; no explicit stale gate

**Bangers (whole-market):**
- Discovery: Polygon grouped-daily (once per session, 12.4k stocks)
- Marks: Polygon live feed via live-sync (cron-driven refresh)
- Stale gate: No explicit signal; relies on contract-probe success rate
- **Fail-soft:** Failed contract probes skip the ticker; no alert

**Legacy (overnight):**
- Theses: Published at EOD (overnight edition)
- Promotion: Morning confirm (fixed time RTH −15 min)
- Stale gate: If morning-confirm fails, promoted theses stale
- **Fail-soft:** Stale theses remain on board but not marked stale

**COHERENCE CHECKS:**

1. ⚠️ **Who marks a position stale?**
   - 0DTE has explicit `discovery_health` signal
   - Swings/Bangers/Legacy do not
   - **RISK:** Members see stale positions on the board without knowing they're stale

2. ⚠️ **Freshness boundaries:**
   - 0DTE marks are 1s fresh; Swings marks are 24h stale (daily OHLC)
   - Members comparing a 0DTE position vs a Swing position see dramatically different data freshness
   - **REQUIREMENT:** UI should flag freshness difference

3. ⚠️ **Failure semantics:**
   - 0DTE: VIX unavailable → firewall blocks (fail-closed)
   - Swings: Flow unavailable → score reduced (fail-soft)
   - Bangers: Chain unavailable → skip (fail-soft)
   - **QUESTION:** Is this intentional stratification or accidental inconsistency?

### Recommendation

- **Extend staleness flagging** to Swings/Bangers/Legacy (add explicit stale gates)
- **UI enhancement:** Render freshness timestamps alongside positions (1s, 24h, overnight, etc.)
- **Alert on critical staleness:** If marks are >30min old for any position, surface an alert

---

## 5. VALIDATION CHECKLIST — SHARED INFRASTRUCTURE

### Database (PostgreSQL)

**Shared schema:**
- `nighthawk_plays` (0DTE)
- `swing_positions` (Swings)
- `banger_positions` (Bangers)
- `nighthawk_play_outcomes` (Swings + Legacy grading)

**Concurrency risks:**
- All cron jobs write to the same Postgres instance
- Pool size is finite (default ~20 connections)
- **Question:** Are connection limits enforced per system or globally?
- **Question:** If one system (e.g., discovery) runs long and exhausts the pool, do others queue/fail?

### Redis (Caching)

**Shared keys:**
- `nighthawk:board:snapshot:v1` (0DTE board)
- `swing:board:snapshot:v1` (Swings board)
- `banger:board:snapshot:v1` (Bangers board, if exposed)
- `zerodte:marks:*` (1s-tick live marks, 0DTE)
- Various other caches (accumulation reads, cortex decisions, etc.)

**Staleness:**
- Board cache: 600s TTL (refreshed per cron)
- Marks cache: 1s TTL (ticked live)
- **Question:** If Redis is unavailable, do systems gracefully degrade or does the desk go dark?

### Polygon API

**Request patterns:**
- 0DTE: ~200–500 calls/session (chains, quotes, bars for discovery/commit/live-sync)
- Swings: ~50–150 calls/session (bars for dossier, contract probes)
- Bangers: ~200–500 calls/session (grouped-daily scan, bars for contract probes)
- Legacy: ~20–50 calls/session (daily bars for geometry re-derivation)
- **Total: ~500–1200 calls per session**
- **Rate limit:** Polygon offers 120 calls/min on standard plans
- **Risk:** If rate limit is exhausted, which system(s) fail? (First-come-first-served, or prioritized?)

### Cron Concurrency

**Daily cron schedule:**
- `nighthawk-morning-confirm` (RTH −15 min): Promote legacy theses
- `swing-discovery` (RTH): Screen multi-day candidates
- `banger-discovery` (RTH): Screen whole-market movers
- `nighthawk-live-sync` (RTH, every 5 min): Refresh 0DTE marks + scale-out
- `swing-live-sync` (RTH, every 10 min): Refresh Swings marks
- `banger-live-sync` (RTH, every 10 min): Refresh Bangers marks
- **Question:** Are cron jobs sequenced to avoid concurrent DB/Polygon peaks?

**COHERENCE CHECKS:**

1. ⚠️ **Postgres pool exhaustion:**
   - If one cron runs long (e.g., swing-discover on a 12.4k-stock day), do others queue?
   - Is there a max queue wait (fail-closed) or silent indefinite wait?

2. ⚠️ **Polygon rate limits:**
   - If rate limit is hit mid-session, which cron backs off?
   - Is there retry logic with exponential backoff?

3. ⚠️ **Redis unavailability:**
   - If Redis is down, can systems continue (fall back to DB) or does the desk go dark?

### Recommendation

- **Load test:** Run all four systems concurrently (morning confirm + all discovery + all live-sync) and measure DB/Polygon load
- **Add observability:** Log pool utilization, rate-limit headers, cache hits/misses per system
- **Define fail-closed gates:** If Polygon rate limit is exceeded, which system(s) stop first?

---

## 6. VALIDATION CHECKLIST — MEMBER EXPERIENCE (UX COHERENCE)

### Layout & Navigation

- **Night Hawk tab:** Intraday 0DTE board (4 discovery lanes, TACTICAL/STANDARD/EXTENDED)
- **Swings tab:** Multi-day thesis board (archetype-driven, TACTICAL/STANDARD/EXTENDED)
- **Bangers tab:** Whole-market momentum (if exposed; may be hidden)
- **Legacy badge:** Promoted overnight theses appear on Swings tab with "NIGHT HAWK" origin badge

**Questions:**
1. ⚠️ Is Bangers visible to all members or gated/hidden?
2. ⚠️ Can members see Bangers + Swings in a unified horizon view, or are they separate tabs?
3. ⚠️ Does the Bangers board have TACTICAL/STANDARD/EXTENDED allocation constraints like 0DTE/Swings?

### Visual Design Consistency

**Execution tiers:**
- 0DTE: Color-coded TACTICAL (green) / STANDARD (blue) / EXTENDED (yellow)
- Swings: Same color scheme?
- Bangers: Same color scheme?

**Status indicators:**
- All systems show: OPEN, PARTIAL, CLOSED_RUNNER, STOPPED
- 0DTE also shows: CLOSED_WIN, CLOSED_LOSS
- Swings/Bangers: How are closed positions marked (by realized P&L sign)?

**Questions:**
1. ⚠️ Are status badges visually consistent across all systems?
2. ⚠️ Do Swings/Bangers show a "realized P&L" badge since they don't have explicit WIN/LOSS status?

### Member Actions

**Entry:** Can members manually enter a position across all systems? (Yes for all)

**Scale-out:** Are scale-out rules (2×, runner, −50%) visible to members?
- 0DTE: Explicit "scale at 2×" rule visible?
- Swings: Explicit exit rules visible?
- Bangers: Explicit exit rules visible?

**Exit:** Can members manually exit across all systems?

**Questions:**
1. ⚠️ Is the scale-out state machine (TAKE_PARTIAL, EXIT_RUNNER, STOP_OUT) visible/explained to members?
2. ⚠️ Do members understand why a position auto-closes at 2×, −50%, or trailing profit?

### Recommendation

- **Unify status badges** across all systems (explicit WIN/LOSS for Swings/Bangers, or remove from 0DTE)
- **Clarify scale-out rules** in UI tooltips / help center
- **Consistent allocation view:** Show TACTICAL/STANDARD/EXTENDED budget usage across all systems in a unified dashboard

---

## 7. KNOWN RISKS — CROSS-SYSTEM

### CRITICAL (Requires Immediate Action)

1. **Outcome definition mismatch:**
   - 0DTE: "target hit" = win
   - Swings: "thesis confirmed AND profitable" = win (different gate)
   - If these definitions diverge, cross-system win-rate comparisons are meaningless

2. **Scale-out rule change propagation:**
   - If `deriveScaleOutAction` rules change, ALL systems (0DTE, Bangers, Swings, Legacy) must re-grade
   - Is there a process to detect this and trigger re-grades?

3. **Polygon provider outage:**
   - ALL systems depend on Polygon for discovery
   - If Polygon is unavailable, all discovery stops
   - No fallback provider configured (per docs)

### HIGH (Requires Audit)

1. **Freshness semantics divergence:**
   - 0DTE marks are 1s fresh; Swings are 24h stale
   - Members comparing positions across systems don't see freshness difference

2. **DB pool exhaustion:**
   - All four systems write to same Postgres instance
   - If one system runs long, others queue or fail
   - No explicit fail-closed gate documented

3. **Entry premium semantics:**
   - 0DTE/Bangers: entry_premium = option premium
   - Swings: entry_premium = underlying price (confusing naming)

### MEDIUM (Requires Monitoring)

1. **Cron concurrency:**
   - No documented sequencing between discovery/live-sync jobs
   - Morning peaks (multiple systems running) may cause load spikes

2. **Allocation budget enforcement:**
   - TACTICAL/STANDARD/EXTENDED constraints enforced per system?
   - Can Bangers exhaust TACTICAL budget, starving Swings?

3. **Failure handling:**
   - 0DTE: Fail-closed (firewall blocks bad data)
   - Swings/Bangers: Fail-soft (continue with reduced quality)
   - Intentional or accidental?

---

## 8. NEXT AUDIT STEPS

### Phase 1: API Consistency (No RTH)
1. Compare field definitions across all systems (status, entry_premium, peak_premium, tier, etc.)
2. Audit `src/lib/largo/contract/product-read.ts` — does it normalize all four systems?
3. Map system-specific fields (archetype, discovery_health, etc.) into product-read envelope

### Phase 2: Grading Invariants (No RTH)
1. Run outcome-grading-audit.mjs on Swings (mechanical vs as-managed agreement check)
2. Sample outcomes from all four systems; verify win/loss definitions align
3. Document re-grading policy: What happens when scale-out rules change?

### Phase 3: Infrastructure (RTH Required)
1. Monitor DB pool utilization during concurrent cron runs (morning peak)
2. Log Polygon API calls per system; verify rate limits not exceeded
3. Redis cache hits/misses per system; verify staleness bounds

### Phase 4: Member Experience (RTH Required)
1. A/B test unified allocation view (all tiers across all systems)
2. Survey members on freshness confusion (1s 0DTE vs 24h Swings)
3. Measure adoption of promoted Legacy theses (manual entry rate)

---

## CERTIFICATION CHECKLIST (CROSS-SYSTEM)

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | API consistency audit | ⏳ | Compare field definitions and product-read conformance |
| 2 | Grading invariant audit | ⏳ | Verify outcome definitions align; run mechanical vs as-managed checks |
| 3 | Freshness semantics | ⏳ | Clarify staleness gates; add explicit stale flags to Swings/Bangers/Legacy |
| 4 | Shared infrastructure load test | ⏳ | Monitor DB/Polygon/Redis during concurrent peak load (RTH) |
| 5 | Cron sequencing | ⏳ | Document concurrency; identify peak-load bottlenecks |
| 6 | Re-grading policy | ⏳ | Define process for handling scale-out rule changes |
| 7 | Member UX coherence | ⏳ | Unify status badges, tier allocation view, scale-out rule visibility |
| 8 | Allocation budget enforcement | ⏳ | Verify TACTICAL/STANDARD/EXTENDED limits span all systems |
| 9 | Fallback/degradation testing | ⏳ | Test each system under Polygon outage, Redis outage, DB pool exhaustion |
| 10 | Cross-system grading correlation | ⏳ | Compare outcomes on positions with identical entry/exit across systems |
| 11 | Rate limit handling | ⏳ | Verify Polygon rate limit triggers backoff, not silent failure |
| 12 | Performance under concurrent load | ⏳ | Measure commit latency, discovery latency, live-sync cadence during peak |

---

**Last updated:** 2026-08-23 22:00 UTC  
**Certification owner:** Claude Night Hawk lane  
**Next step:** API consistency audit (no RTH needed), then infrastructure load test (RTH required)
