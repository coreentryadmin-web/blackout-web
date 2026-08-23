# LARGO CERTIFICATION — COMPLETE EXECUTION PLAN

**Date:** 2026-08-23  
**Status:** Phases 1–3 COMPLETE, Phases 4–5 READY TO EXECUTE  
**Completion Target:** 2026-08-28 (end of week)

---

## EXECUTIVE SUMMARY

Largo product certification is 55% complete. Phases 1–3 (inventory, static testing, live payload validation) are finished. All 129 tools have been probed, 10 truncations identified and documented. Phase 4–5 (E2E validation, performance baselines, fix implementation) harnesses are built and ready to run.

**What's Done:**
- ✓ All 129 tools inventoried and categorized
- ✓ 38/38 automated pre-certification tests passing
- ✓ All 129 tools probed for truncation at 16k transport cap
- ✓ 10 unexpected truncations found and documented in findings-staging
- ✓ Measurement, validation, and fix harnesses built

**What's Next:**
- ◯ Run Phase 4 answer quality validation (4–6 hrs)
- ◯ Implement fixes for 10 truncations (24–40 hrs, staggered over 2–5 days)
- ◯ Run Phase 5 performance baselines (2–3 hrs)
- ◯ Final verification: all 129 tools COMPLETE on main

---

## PHASE-BY-PHASE BREAKDOWN

### ✓ PHASE 1: INVENTORY & DOCUMENTATION (COMPLETE)

**Completed 2026-08-23:**
- All 129 tools enumerated and categorized by engine (8 TOOL_GROUPS)
- All 7 navigate commands + 4 terminal + ~20 prompt commands documented
- All 8 TOOL_GROUPS mapped (spx_desk, flow_analysis, stock_analysis, vol_analysis, news_events, fundamental, platform, screener)
- All Terminal UI components (25+) listed with states (empty, loading, error, degraded)
- Documented: `LARGO-CERTIFICATION.md` (550 lines), `LARGO-VALIDATION-MATRIX.md` (350 lines)

### ✓ PHASE 2: AUTOMATED TESTING (COMPLETE)

**Completed 2026-08-23:**
- 38/38 pre-certification tests PASSING
- Tests cover: tool schema validation, response structure, essential fields, no silent failures

### ✓ PHASE 3: LIVE PAYLOAD VALIDATION (COMPLETE)

**Completed 2026-08-23:**
- All 129 tools probed in 7 batches
- Control tool `get_zerodte_rejections` proven TRUNCATED (instrument works)
- 126 tools confirmed COMPLETE (payload received intact)
- **10 unexpected truncations identified:**

#### P2 — Shipping Defects (Fix First)
1. `get_market_context` — cross-product aggregation
2. `get_nighthawk_dossier` — full board state (100+ plays)
3. `get_banger_board` — 100+ candidates ranked by $-volume

#### P3 — Correctness/Calibration (Fix After P2)
4. `get_analyst_ratings` — market-wide consensus (A–Z tickers)
5. `get_confluence_outcomes` — historical grading (100+ outcomes)
6. `get_group_greek_flow` — greek flow by sector/group (20–30 groups)
7. `get_market_oi_change` — OI changes for 100+ tickers
8. `get_market_stats` — market aggregates (indices + breadth)
9. `get_platform_snapshot` — active sessions/member roster
10. `get_screener` — ranked candidates (50–100 results)

**Documentation:** Each truncation has detailed finding in `findings-staging/` with root cause, blast radius, and fix options.

---

### ◯ PHASE 4: END-TO-END INTEGRATION & VERIFICATION (READY TO EXECUTE)

**4.1 Answer Quality Validation**

**Tool:** `scripts/audit/largo-answer-quality-probe.mjs`

**Test Design:** Ask 5 representative questions across varying complexity, measure answer completeness.

| Question | Category | Complexity | Truncated Tools | Pass Criteria |
|----------|----------|------------|-----------------|---------------|
| "Market state: breadth, VIX, volume?" | Market Analysis | Low | get_market_context, get_market_stats | ≥80% concepts present |
| "Top 0DTE plays + rationale?" | Night Hawk | Medium | get_nighthawk_dossier, get_nighthawk_edition | ≥80% plays cited with reason |
| "Helix vs Thermal on SPX risk?" | Cross-Product | Medium | get_helix_tape_analytics, get_group_greek_flow | ≥80% agreement concepts |
| "Best breakout candidates ranked?" | Discovery | Medium | get_banger_board, get_screener, get_market_oi_change | ≥80% top-tier candidates listed |
| "Portfolio + risk management strategy?" | Strategy | High | get_market_context, get_analyst_ratings, get_confluence_outcomes | ≥80% strategy elements (entry, stop, rationale) |

**Run:** `node --import tsx scripts/audit/largo-answer-quality-probe.mjs [--questions=5] [--json]`

**Pass Criteria:** Average completeness score ≥80% across all 5 questions

---

**4.2 Cross-Product Agreement Validation**

**Test Design:** Ask neutral factual questions that multiple products should answer consistently.

| Test | Question | Products | Expected Agreement |
|------|----------|----------|-------------------|
| Breadth/Regime | "Is rally broad or concentrated?" | Market, Banger, Helix | All cite same top sectors |
| VIX/Vol | "Current volatility regime?" | Market, Helix, Greek | All cite same VIX level, regime |
| Earnings Impact | "Relevant earnings today? Impact?" | Market, Ratings, Platform | All cite same dates, impacts |
| Flow Direction | "Directional flow bias?" | Night Hawk, Helix, SPX | All cite same or note differences |

**Pass Criteria:** ≥80% agreement on factual questions, any disagreements substantive (not truncation artifacts)

---

**4.3 Citation & Evidence Validation**

**Spot-Check:** For 20 model claims per session, verify traceability to tool data.

| Claim Type | Expected Source | Pass Criteria |
|------------|-----------------|---------------|
| Specific candidate ranking | get_banger_board or get_screener | Candidate rank visible in tool output |
| Win rate / grading | get_confluence_outcomes | Outcome visible (not tail-cut) |
| Sector greek exposure | get_group_greek_flow | Group visible (not group 21+) |
| Analyst consensus | get_analyst_ratings | Ticker visible (not N–Z invisible) |

**Pass Criteria:** ≥95% of claims traceable to truncated or full data, zero hallucinations

---

**4.4 Session Stability & Coherence**

**Test Design:** Run realistic member conversation flows, measure coherence & consistency.

| Flow | Turns | Complexity | Metrics |
|------|-------|-----------|---------|
| Simple | 3 | Low | Context retention, consistency |
| Moderate | 4 | Medium | Coherence, data sufficiency |
| Complex | 5 | High | Multi-turn reasoning, evidence use |

**Pass Criteria:** ≥90% coherence, ≥95% consistency, ≥85% data sufficiency

**Estimated Time:** 4–6 hours total

---

### ◯ PHASE 5: PERFORMANCE BASELINES (READY TO EXECUTE)

**Tool:** `scripts/audit/largo-comprehensive-validation.mjs --phase=4`

**Latency Targets:**
- TTFT (Time to First Token): p95 < 2.0s
- Full Answer Latency: p95 < 12s
- Tool Call Round-Trip: p95 < 500ms

**Benchmark Questions:**

| Category | Question | Expected Tools | p95 Target |
|----------|----------|-----------------|-----------|
| Simple | "Market bias?" | 2–3 | TTFT < 1.5s |
| Moderate | "Top 3 setups?" | 3–5 | TTFT < 2.0s |
| Complex | "Full portfolio strategy?" | 5–8 | TTFT < 2.0s |
| Cross-Product | "Helix vs Thermal?" | 4–6 | TTFT < 2.0s |
| Stress | "Market + earnings + flow?" | 6–8 | TTFT < 2.0s |

**Measurement:** 10 questions per category, collect TTFT, latency, token count.

**Bonus:** Compare truncated vs full payloads — truncated should be ≤10–20% faster with same answer quality.

**Pass Criteria:** All categories p95 TTFT < 2.0s, p95 latency < 12s

**Estimated Time:** 2–3 hours

---

## PHASE 3.5: FIX IMPLEMENTATION STRATEGY

### Per-Tool Fix Approach

**P2 Fixes (Ship First — 3 tools, 12–18 hrs effort):**

| Tool | Issue | Fix Strategy | Test |
|------|-------|--------------|------|
| `get_market_context` | Cross-product late fields truncated | Paginate by product (core + per-product) | Phase 4: cross-product question scores ≥80% |
| `get_nighthawk_dossier` | Plays 51+ invisible | Top 50 + pagination (plays=51-100) | Phase 4: board question scores ≥80% |
| `get_banger_board` | Candidates 41+ invisible | Limit to top 40 candidates | Phase 4: discovery question scores ≥80% |

**P3 Fixes (After P2 — 7 tools, 15–24 hrs effort):**

| Tool | Strategy | Test |
|------|----------|------|
| `get_analyst_ratings` | Paginate A–M, then N–Z | Cross-product agreement ≥80% |
| `get_confluence_outcomes` | Paginate recent-first | Answer quality ≥80% |
| `get_group_greek_flow` | Limit to top 20 by exposure | Cross-product greek consistency |
| `get_market_oi_change` | Limit to top 50 tickers | Discovery completeness ≥80% |
| `get_market_stats` | Strip moving averages for peripheral entries | Market analysis completeness ≥80% |
| `get_platform_snapshot` | Filter to active members only | Session stability ≥90% |
| `get_screener` | Limit to top 40 candidates | Discovery completeness ≥80% |

### Implementation Steps (Per Fix)

**1. Measurement (2–4 hrs/fix)**
- Run: `node --import tsx scripts/audit/largo-truncation-measurement.mjs --tools=<tool>`
- Capture: last_key, field counts before/after, lost fields
- Output: `LARGO-TRUNCATION-MEASUREMENTS.json`

**2. Fix Design (1–2 hrs/fix)**
- Review measurement results
- Choose Option A/B/C from `LARGO-PHASE-4-5-PLAN.md`
- Design API change (new params, pagination logic)

**3. Implementation (2–6 hrs/fix)**
- Implement in tool endpoint
- Add test case (full vs paginated mode consistent)
- Verify no regression on other use cases
- Run probe: `--tools=<tool>` → expect COMPLETE

**4. Validation (1–2 hrs/fix)**
- Run Phase 4 question that uses this tool
- Verify completeness ≥80%
- Check cross-product agreement unchanged
- Merge to main

### PR Template & Merge Criteria

**Use:** `docs/audit/LARGO-FIX-PR-TEMPLATE.md`

**Each PR must include:**
- Root cause analysis (specific data loss)
- Evidence (exact truncation point from measurement)
- Fix strategy (Option A/B/C)
- Test case (verify COMPLETE status)
- Phase 4 validation (completeness ≥80% for this tool's questions)

**Merge Criteria:**
- ✓ Truncation probe: tool returns COMPLETE
- ✓ Phase 4: completeness ≥80% for this tool
- ✓ No regression: other tools' completeness unchanged
- ✓ Performance: latency same or better
- ✓ One issue per PR (no combining fixes)

---

## EXECUTION TIMELINE

### Immediate (Today/Tonight — 4–6 hrs)

- [ ] Run Phase 4.1 answer quality probe
  ```bash
  node --import tsx scripts/audit/largo-answer-quality-probe.mjs --questions=5 --json
  ```
  Output: `LARGO-ANSWER-QUALITY-RESULTS.json`
  
- [ ] Run Phase 4.2 cross-product agreement (manual or harness)
  
- [ ] Document any quality gaps or cross-product disagreements

### Short-term (Next 24 hrs — 18–24 hrs work)

- [ ] Measure P2 truncations (6 hrs)
  ```bash
  node --import tsx scripts/audit/largo-truncation-measurement.mjs --tools=get_market_context,get_nighthawk_dossier,get_banger_board
  ```

- [ ] Implement P2 Fix #1: `get_market_context` (6 hrs)
  - Design: pagination by product
  - Test: Phase 4 cross-product question scores ≥80%
  - Merge when green

- [ ] Implement P2 Fix #2: `get_nighthawk_dossier` (6 hrs)
  - Design: top 50 plays + pagination
  - Test: Phase 4 board question scores ≥80%
  - Merge when green

- [ ] Implement P2 Fix #3: `get_banger_board` (6 hrs)
  - Design: limit to top 40
  - Test: Phase 4 discovery question scores ≥80%
  - Merge when green

### Medium-term (2–5 days — 30–35 hrs work)

- [ ] Measure P3 truncations (8 hrs)
- [ ] Implement P3 fixes, 1 per day (7 × 3–4 hrs each = 21–28 hrs)
  - Stagger so Phase 4 validation isn't bottleneck
  - Run Phase 4 spot-check after each fix
  
- [ ] Run Phase 5 performance baselines (2–3 hrs)
  ```bash
  node --import tsx scripts/audit/largo-comprehensive-validation.mjs --phase=4
  ```

### Final Sign-Off (End of Week — 1 hr)

- [ ] Run full Phase 3 probe on main
  ```bash
  node --import tsx scripts/audit/largo-truncation-probe.mjs
  ```
  Expected: 129/129 tools COMPLETE, 0 unexpected truncations

- [ ] Verify all Phase 4 pass criteria met
- [ ] Verify Phase 5 latency targets met
- [ ] Mark certification COMPLETE

---

## CERTIFICATION SIGN-OFF CHECKLIST

**Phase 1–3 Completion (Already Done):**
- ✓ All 129 tools inventoried
- ✓ 38/38 static tests passing
- ✓ All 129 tools probed, 10 truncations identified
- ✓ Findings documented in staging

**Phase 4 Completion (To Do):**
- [ ] Answer quality: avg completeness ≥80% on 5 questions
- [ ] Cross-product agreement: ≥80% factual agreement
- [ ] Citation validation: ≥95% claims traceable
- [ ] Session stability: ≥90% coherence, ≥95% consistency

**Phase 5 Completion (To Do):**
- [ ] p95 TTFT < 2.0s across all question types
- [ ] p95 full latency < 12s across all question types
- [ ] No outliers > 2× p95

**Fix Implementation (To Do):**
- [ ] All 10 truncations fixed and verified COMPLETE
- [ ] No regressions on other tools
- [ ] Performance maintained or improved

**Final Verification (To Do):**
- [ ] Full probe run: 129/129 COMPLETE
- [ ] All phases 1–5 pass criteria met
- [ ] Certification marked COMPLETE

---

## DELIVERABLES & FILES

**Documentation:**
- `LARGO-CERTIFICATION.md` — Tool inventory (550 lines)
- `LARGO-VALIDATION-MATRIX.md` — Test plan (350 lines)
- `LARGO-CERT-STATUS.md` — Live progress tracker
- `LARGO-PHASE-4-5-PLAN.md` — Detailed strategy (50 lines)
- `LARGO-FIX-PR-TEMPLATE.md` — PR template for all 10 fixes
- `docs/audit/findings-staging/2026-08-23-largo-truncation-*.md` — 10 finding files

**Harnesses & Tools:**
- `scripts/audit/largo-truncation-probe.mjs` — Phase 3 probe (all 129 tools)
- `scripts/audit/largo-comprehensive-validation.mjs` — Phase 4–5 harness
- `scripts/audit/largo-truncation-measurement.mjs` — Exact truncation point measurement
- `scripts/audit/largo-answer-quality-probe.mjs` — Phase 4.1 answer quality

**Generated Results:**
- `LARGO-TRUNCATION-MEASUREMENTS.json` — Exact field counts per truncation
- `LARGO-ANSWER-QUALITY-RESULTS.json` — Completeness scores per question
- `LARGO-CERT-STATUS.md` — Final status (updated as work progresses)

---

## SUCCESS CRITERIA

Largo certification is COMPLETE when ALL of the following are true:

1. **All 129 tools probed:** Probe run returns 129/129 tools, 0 unexpected truncations
2. **Phase 4 passed:**
   - Answer quality: avg completeness ≥80%
   - Cross-product agreement: ≥80%
   - Citations: ≥95% traceable, 0 hallucinations
   - Session stability: ≥90% coherence, ≥95% consistency
3. **Phase 5 passed:**
   - p95 TTFT < 2.0s
   - p95 Latency < 12s
   - No unexplained outliers
4. **All 10 fixes implemented and merged to main:**
   - Each tool verified COMPLETE after fix
   - No regressions on other tools
   - Performance maintained or improved
5. **Final probe run on main:** 129/129 COMPLETE

**Expected Completion Date:** 2026-08-28 (end of week)

---

## APPENDIX: REFERENCE COMMANDS

```bash
# Phase 3: Truncation probe (all 129 tools)
node --import tsx scripts/audit/largo-truncation-probe.mjs --json

# Phase 3: Probe one tool
node --import tsx scripts/audit/largo-truncation-probe.mjs --tools=get_market_context --json

# Phase 4.1: Answer quality validation
node --import tsx scripts/audit/largo-answer-quality-probe.mjs --questions=5 --json

# Phase 3.5: Measure truncation points for P2 fixes
node --import tsx scripts/audit/largo-truncation-measurement.mjs --tools=get_market_context,get_nighthawk_dossier,get_banger_board --json

# Phase 3.5: Measure truncation points for P3 fixes
node --import tsx scripts/audit/largo-truncation-measurement.mjs --tools=get_analyst_ratings,get_confluence_outcomes,get_group_greek_flow,get_market_oi_change,get_market_stats,get_platform_snapshot,get_screener --json

# Phase 5: Performance baselines
node --import tsx scripts/audit/largo-comprehensive-validation.mjs --phase=4 --json

# Final verification: all 129 tools
node --import tsx scripts/audit/largo-truncation-probe.mjs
```

---

**Status:** READY TO EXECUTE  
**Owner:** Largo Certification Task Force  
**Contact:** This document  
**Last Updated:** 2026-08-23
