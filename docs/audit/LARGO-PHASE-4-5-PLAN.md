# LARGO PHASES 4–5 VALIDATION & FIX PLAN

**Status:** Phase 3 complete (all 129 tools probed, 10 truncations documented)  
**Date:** 2026-08-23  
**Updated:** 2026-08-23

---

## PHASE 4: END-TO-END INTEGRATION & VERIFICATION

**Goal:** Validate that truncations do not degrade answer quality, cross-product reasoning, or member experience.

### 4.1 Answer Quality Validation

**Test Design:**
- Ask the same 5 representative questions across different complexity levels
- Measure answer completeness with full vs truncated tool payloads
- Document any drift in reasoning quality or missing context

**Questions (Increasing Complexity):**

1. **Simple Market Context** (uses 1–2 truncated tools)
   - Question: "What's the overall market bias right now?"
   - Tools: `get_market_context`, `get_market_stats`
   - Expectation: Model should summarize breadth, regime, VIX, volume
   - Failure Scenario: Model lists only partial breadth (e.g., top 10 instead of all 20 groups)

2. **Multi-Product Setup** (uses 2–3 tools, cross-product)
   - Question: "Compare Night Hawk and Banger board views. What's different?"
   - Tools: `get_nighthawk_dossier`, `get_banger_board`
   - Expectation: Model cites specific plays and candidates from each
   - Failure Scenario: Model only mentions top 30 plays (missing 20+ others due to truncation)

3. **Complex Reasoning** (uses 4+ tools, multiple truncations)
   - Question: "Build a 3-play portfolio: aggressive, moderate, conservative. Include exact stops and targets."
   - Tools: `get_nighthawk_edition`, `get_analyst_ratings`, `get_confluence_outcomes`, `get_banger_board`
   - Expectation: Model cites grading evidence and conviction from each source
   - Failure Scenario: Model makes up win rates or lacks conviction data due to truncated outcomes

4. **Cross-Product Consensus** (Helix + Thermal)
   - Question: "Do Helix and Thermal agree on SPX risk? What's different?"
   - Tools: `get_helix_tape_analytics`, `get_helix_thermal_compare`, `get_group_greek_flow`
   - Expectation: Model reconciles agreement and disagreements with evidence
   - Failure Scenario: Model misses sector-level greek exposure that would explain disagreement

5. **Market Regime with Earnings** (uses 5+ tools)
   - Question: "Given current market regime, breadth, and earnings calendar, what's the strategic approach?"
   - Tools: `get_market_context`, `get_market_stats`, `get_analyst_ratings`, `get_confluence_outcomes`, `get_market_oi_change`
   - Expectation: Model synthesizes regime + earnings + OI + ratings into actionable strategy
   - Failure Scenario: Model misses OI rotation data or uses only partial ratings (A–M tickers visible, N–Z invisible)

**Measurement:**
- Run each question 3 times, measure answer consistency
- Check for presence of expected evidence/citations
- Identify missing data that truncation would cause
- Score completeness: 0–100 (100 = full answer, 0 = missing core evidence)

**Pass Criteria:**
- All 5 questions score ≥80 completeness
- No truncation-caused hallucinations (model admitting missing data is acceptable)
- Cross-product reasoning remains coherent

---

### 4.2 Cross-Product Agreement Validation

**Test Design:**
- Ask neutral questions that multiple products should answer consistently
- Verify agreement on factual market state (not subjective calls)
- Detect disagreements and verify they are legitimate (not truncation artifacts)

**Agreement Tests:**

1. **Breadth/Regime Consensus**
   - Question: "Is the market rally broad or concentrated? Which sectors lead?"
   - Products: Market Analysis (context), Banger (candidates), Helix (tape)
   - Expected Agreement: All cite same top sectors or note where concentrated
   - Truncation Risk: `get_group_greek_flow` loses groups 21+, `get_banger_board` loses candidates 41+

2. **VIX/Volatility Regime**
   - Question: "What's the current volatility regime?"
   - Products: Market Context, Helix, Greek Flow
   - Expected Agreement: All cite same VIX level, implied vol, realized vol
   - Truncation Risk: Partial market stats lead to incomplete regime picture

3. **Earnings Calendar Impact**
   - Question: "What earnings events are relevant today? How do they affect positioning?"
   - Products: Market Context, Analyst Ratings, Platform Context
   - Expected Agreement: All cite same earnings dates, impact expected
   - Truncation Risk: `get_analyst_ratings` loses ratings N–Z (limited earnings coverage)

4. **Flow Direction (SPX/QQQ/IWM)**
   - Question: "What's the directional flow bias in the broad market?"
   - Products: Night Hawk, Helix, SPX Slayer
   - Expected Agreement: All cite same direction or note product-specific differences
   - Truncation Risk: Partial OI/flow data leads to contradictory positions

**Measurement:**
- For each test, ask product-specific versions, then ask "reconcile these views"
- Count agreements vs disagreements
- For disagreements, verify they are substantive (not truncation artifacts)

**Pass Criteria:**
- ≥80% agreement on factual questions (breadth, regime, earnings dates)
- Any disagreements explained by legitimate product differences (not data loss)
- No "contradictory" positions that reverse on re-run

---

### 4.3 Citation & Evidence Validation

**Test Design:**
- Audit a sample of model answers for traceable claims
- Verify evidence comes from truncated vs full payloads
- Detect hallucinated citations (made-up data)

**Test Cases:**

1. **Specific Candidate Ranking**
   - Model claims: "NVDA is the top momentum candidate with 15% daily gain"
   - Trace: Should cite from `get_banger_board` or `get_screener`
   - Risk: Tool truncates at 40 candidates; NVDA might rank 60th and be invisible

2. **Win Rate / Grading Claims**
   - Model claims: "Confluence setups won 68% last month"
   - Trace: Should cite from `get_confluence_outcomes`
   - Risk: Tool truncates outcomes; model quotes visible sample, misses tail

3. **Sector Greek Exposure**
   - Model claims: "Tech sector is short gamma, Healthcare is long"
   - Trace: Should cite from `get_group_greek_flow`
   - Risk: Tool truncates at 20 groups; specialty sectors (biotech, regional banks) invisible

4. **Analyst Consensus**
   - Model claims: "Rating distribution is 60% Buy, 30% Hold, 10% Sell"
   - Trace: Should cite from `get_analyst_ratings`
   - Risk: Tool truncates A–M tickers; N–Z missing, skews distribution

**Measurement:**
- Spot-check 20 model claims per session
- Verify each claim traces to a tool output
- Flag any that cannot be traced to visible data

**Pass Criteria:**
- ≥95% of claims traceable to truncated or full data
- Zero hallucinated claims (claims with no data source)
- Any claims from truncated data flagged as "based on visible data"

---

### 4.4 Session Stability & Speech Coherence

**Test Design:**
- Run 10–15 real member conversation flows (3–5 turns each)
- Measure for mid-session breakdowns (model loses context, forgets prior claims)
- Detect "contradiction" patterns that suggest truncation artifacts

**Flows:**

1. **Simple Session** (3 turns)
   - Turn 1: "What's today's best setup?"
   - Turn 2: "Why is that better than X?"
   - Turn 3: "Should I take it at current levels?"

2. **Moderate Session** (4 turns)
   - Turn 1: "Build a 2-play portfolio"
   - Turn 2: "Explain the risk on Play 1"
   - Turn 3: "How do I adjust if SPX breaks support?"
   - Turn 4: "When do I take profit on Play 2?"

3. **Complex Session** (5 turns)
   - Turn 1: "Full market analysis + strategy"
   - Turn 2: "Top 3 positions with exact entries/stops"
   - Turn 3: "How do earnings calendar change the plan?"
   - Turn 4: "Walk me through position management"
   - Turn 5: "What's the plan if regime shifts?"

**Measurement:**
- Coherence: Does model remember prior context?
- Consistency: Do later turns contradict earlier claims?
- Completeness: Does model have enough data to answer?

**Pass Criteria:**
- ≥90% session coherence (model remembers context)
- ≥95% consistency (no contradictions)
- ≥85% data sufficiency (model doesn't say "I don't have enough data")

---

## PHASE 5: PERFORMANCE BASELINES

**Goal:** Establish acceptable latency and throughput for member-facing agent.

### 5.1 Latency Targets (from LARGO-VALIDATION-MATRIX.md)

| Metric | Target | Method |
|--------|--------|--------|
| TTFT (Time to First Token) | p95 < 2.0s | Measure time from question submit to first token |
| Full Answer Latency | p95 < 12s | Measure time from question submit to last token |
| Tool Call Round-Trip | p95 < 500ms | Measure time for one tool call cycle |

### 5.2 Baseline Measurement

**Setup:**
- 10 questions per category (simple, moderate, complex)
- Measure on production environment
- Record: TTFT, full latency, tool count, payload sizes

**Categories:**

| Category | Representative Question | Expected Tools | Complexity |
|----------|-------------------------|-----------------|------------|
| Simple | "What's the market bias?" | 2–3 | Low |
| Moderate | "Show me top 3 setups with rationale" | 3–5 | Medium |
| Complex | "Build full portfolio + risk management" | 5–8 | High |
| Cross-Product | "Compare Helix and Thermal views" | 4–6 | High |
| Stress | "Market analysis + earnings + flow synthesis" | 6–8 | Very High |

**Measurement Protocol:**
1. Warm up: 2 questions to warm caches
2. Run: 10 questions per category
3. Collect: TTFT, full latency, tool count, token count
4. Analyze: p50, p95, max per category

**Pass Criteria:**
- p95 TTFT < 2.0s across all categories
- p95 Full Latency < 12s across all categories
- No outliers > 2× p95 without explanation

### 5.3 Truncation Impact on Performance

**Hypothesis:** Truncated payloads should improve latency (fewer tokens to process).

**Test:**
- Same 10 questions, measure with both full and truncated payloads
- Compare TTFT and latency
- Expected: Truncated faster, but answer quality unchanged

**Measurement:**
- Compare TTFT: truncated vs full (expect 10–20% faster)
- Compare answer length: truncated vs full (expect similar word count)
- Compare latency: truncated vs full (expect 5–15% faster)

**Pass Criteria:**
- Truncated payloads do not increase latency
- Answer quality unchanged (completeness score same)
- Truncated responses are roughly same length as full

---

## PHASE 3.5: FIX IMPLEMENTATION PLAN

### Per-Tool Fix Strategy

**Truncations by Priority & Fix Approach:**

#### P2 — SHIPPING DEFECTS (Do First)

| Tool | Issue | Data Loss | Recommended Fix | Effort | Impact |
|------|-------|-----------|-----------------|--------|--------|
| `get_market_context` | Cross-product aggregation payload | Late fields | Paginate products or strip redundancy | High | High |
| `get_nighthawk_dossier` | Full board state | Plays 51+ invisible | Pagination (top 50 plays, fetch more on demand) | Medium | High |
| `get_banger_board` | 100+ candidates ranked | Candidates 41+ invisible | Limit to top 40 OR pagination | Low | Medium |

#### P3 — CORRECTNESS/CALIBRATION (Do After P2)

| Tool | Issue | Data Loss | Recommended Fix | Effort | Impact |
|------|-------|-----------|-----------------|--------|--------|
| `get_analyst_ratings` | Market-wide consensus | Tickers N–Z missing | Pagination (A–M, then N–Z) OR top-N by importance | Medium | Low |
| `get_confluence_outcomes` | Historical grading sample | Old-only outcomes | Pagination (recent first) | Low | Low |
| `get_group_greek_flow` | Greek by group | Groups 21+ missing | Limit to top 20 by exposure OR paginate | Medium | Medium |
| `get_market_oi_change` | OI changes 100+ tickers | Tickers 51+ invisible | Limit to top 50 OR pagination | Low | Low |
| `get_market_stats` | Market aggregates | Indices/breadth truncated | Strip moving averages for peripheral entries | Low | Low |
| `get_platform_snapshot` | Active sessions | Members 15+ invisible | Filter to active only OR paginate | Low | Low |
| `get_screener` | Ranked candidates | Candidates outside top 40 | Limit to top 40 OR pagination | Low | Low |

### Implementation Steps (Per Issue)

#### Step 1: Measurement (2–4 hours per issue)
- Run `largo-truncation-measurement.mjs` to capture exact field count at truncation
- Document: last_key, fields before/after, impact on specific use cases
- Result: `docs/audit/LARGO-TRUNCATION-MEASUREMENTS.json` with detailed field inventory

#### Step 2: Fix Design (1–2 hours per issue)
- Review measurement results
- Choose Option A/B/C per finding recommendation
- Design API change (new endpoint, pagination params, field filtering)
- Document in finding file

#### Step 3: Implementation (2–6 hours per issue)
- Implement fix in tool
- Add test case (full vs truncated mode)
- Verify no regression on other use cases
- Run `largo-truncation-probe.mjs --tools=<tool>` to confirm COMPLETE status

#### Step 4: Integration Testing (1–2 hours per issue)
- Run Phase 4 answer quality test with this tool
- Verify model reasoning unchanged
- Check cross-product agreement still holds
- Merge to main

#### Step 5: Verification (30 min per issue)
- Run full Phase 3 probe: `largo-truncation-probe.mjs --tools=<tool>` → expect COMPLETE
- Run Phase 4 spot-check: 5 representative questions with model
- Confirm tool now appears in "COMPLETE" list

---

## TIMELINE & SEQUENCING

### Immediate (Today/Tonight)
- [ ] Run Phase 4 answer quality validation (4 hours)
- [ ] Run Phase 4 cross-product agreement (2 hours)
- [ ] Run Phase 5 baseline measurement (2 hours)
- [ ] Document any quality gaps or cross-product disagreements

### Short-term (Next 24–48 hours)
- [ ] Measurement phase for P2 truncations (6 hours)
- [ ] Implement fixes for P2 truncations (12–18 hours, 3 issues)
- [ ] Phase 4 E2E validation of P2 fixes (3 hours)
- [ ] Merge P2 fixes to main

### Medium-term (Next 3–5 days)
- [ ] Measurement phase for P3 truncations (8 hours)
- [ ] Implement fixes for P3 truncations (15–24 hours, 7 issues)
- [ ] Phase 4 E2E validation of P3 fixes (4 hours)
- [ ] Merge P3 fixes to main

### Final Sign-Off (End of week)
- [ ] Run full Phase 3 probe on main: all 129 tools → expect all COMPLETE
- [ ] Run Phase 4 full integration test
- [ ] Run Phase 5 performance baselines
- [ ] Mark certification COMPLETE

---

## CERTIFICATION SIGN-OFF CRITERIA

Phase 4–5 Complete when:

✓ All 10 truncation fixes merged and verified COMPLETE on main  
✓ Phase 4.1 answer quality: ≥80 completeness on 5 representative questions  
✓ Phase 4.2 cross-product agreement: ≥80% factual agreement across products  
✓ Phase 4.3 citation validation: ≥95% claims traceable to tool data  
✓ Phase 4.4 session stability: ≥90% coherence, ≥95% consistency  
✓ Phase 5 performance: p95 TTFT < 2s, p95 latency < 12s across all question types  
✓ No truncations remaining: all 129 tools report COMPLETE on final probe  

**Expected Completion:** 2026-08-28 (end of week)

---

## Files Generated

- `scripts/audit/largo-comprehensive-validation.mjs` — Phase 4–5 harness
- `scripts/audit/largo-truncation-measurement.mjs` — Measurement tool for exact truncation points
- `docs/audit/LARGO-TRUNCATION-MEASUREMENTS.json` — Raw measurement data (auto-generated)
- `docs/audit/LARGO-PHASE-4-5-PLAN.md` — This file (strategy + sign-off criteria)
