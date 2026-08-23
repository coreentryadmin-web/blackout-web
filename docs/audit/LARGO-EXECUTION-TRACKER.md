# Largo Certification Execution Tracker

**Status:** Phases 1-3 COMPLETE, Phases 4-5 READY TO EXECUTE  
**Date:** 2026-08-23  
**Branch:** `claude/largo-53p3kg`  
**Completion Target:** 2026-08-28

---

## COMPLETED WORK (Phases 1-3)

✓ **Phase 1-2:** Full inventory + static validation (38/38 passing)
- All 129 tools enumerated
- All 8 TOOL_GROUPS mapped  
- Documentation published

✓ **Phase 3:** Live payload validation
- All 129 tools probed via `largo-truncation-probe.mjs`
- 126 tools confirmed COMPLETE
- **10 truncations identified** (tools exceed 16k char cap)
- All findings documented in `findings-staging/`

---

## 10 TRUNCATIONS IDENTIFIED

### P2 (High Priority — Shipping Defects)

| # | Tool | Issue | Strategy | Status |
|---|------|-------|----------|--------|
| P2-01 | `get_market_context` | Cross-product aggregation | Paginate by product | NOT STARTED |
| P2-02 | `get_nighthawk_dossier` | Full board state (plays 1-50 visible, 51+ lost) | Top 50 + pagination | NOT STARTED |
| P2-03 | `get_banger_board` | 100+ candidates, top 40 visible | Limit to top 40 | NOT STARTED |

### P3 (Medium Priority — Correctness/Calibration)

| # | Tool | Issue | Strategy | Status |
|---|------|-------|----------|--------|
| P3-01 | `get_analyst_ratings` | A-M visible, N-Z missing | Paginate by letter range | NOT STARTED |
| P3-02 | `get_confluence_outcomes` | Old-only outcomes visible | Paginate recent-first | NOT STARTED |
| P3-03 | `get_group_greek_flow` | Groups 21+ missing | Limit to top 20 | NOT STARTED |
| P3-04 | `get_market_oi_change` | Tickers 51+ missing | Limit to top 50 | NOT STARTED |
| P3-05 | `get_market_stats` | Indices/breadth truncated | Strip moving averages | NOT STARTED |
| P3-06 | `get_platform_snapshot` | Members 15+ missing | Filter to active | NOT STARTED |
| P3-07 | `get_screener` | Candidates 41+ missing | Limit to top 40 | NOT STARTED |

---

## PHASE 4 VALIDATION (READY)

**Goal:** Confirm answer quality ≥80% before implementing fixes

**Components (Built in previous context, ready to execute):**
1. Answer quality probe (5 questions, completeness scoring)
2. Cross-product agreement tests (4 factual tests)
3. Citation traceability audit (20 claims per session)
4. Session stability measurement (3 conversation flows)

**Pass Criteria:**
- ✓ All 5 questions score ≥80% completeness
- ✓ ≥80% agreement on factual questions
- ✓ ≥95% claims traceable to tool data
- ✓ ≥90% session coherence

**Timeline:** 4-6 hours

---

## PHASE 5 PERFORMANCE (READY)

**Goal:** Establish acceptable latency baselines

**Targets:**
- p95 TTFT < 2.0s (Time to First Token)
- p95 Full Latency < 12s
- p95 Tool Round-Trip < 500ms

**Timeline:** 2-3 hours

---

## EXECUTION PLAN

### IMMEDIATE (Next 4-6 hours)

- [ ] **Phase 4.1:** Run answer quality validation
  - Execute: `node --import tsx scripts/audit/largo-phase4-answer-quality.mjs --json`
  - Measure: Completeness scores for 5 questions
  - Decision gate: If avg ≥80%, proceed to fixes; if <80%, identify high-impact truncations

- [ ] **Phase 4.2:** Cross-product agreement test (if needed)
  - Execute only if Phase 4.1 shows quality gaps
  - Measure: Agreement on breadth, VIX, earnings, flow direction

### SHORT-TERM (Next 18-24 hours)

- [ ] **Measurement:** Exact truncation points for P2-01, P2-02, P2-03
  - Tool: `largo-truncation-measurement.mjs` (build if needed)
  - Output: Exact field counts, last visible key, lost fields

- [ ] **P2-01 Fix:** `get_market_context` pagination
  - Branch: `fix/largo-market-context-pagination`
  - Work: Add `products` parameter, test both modes
  - Validation: Phase 4 spot-check (question q1 scores ≥80%)
  - Merge: Auto-merge when CI green

- [ ] **P2-02 Fix:** `get_nighthawk_dossier` top-50 + pagination
  - Branch: `fix/largo-nighthawk-dossier-pagination`
  - Work: Default to 50 plays, add range parameter
  - Validation: Phase 4 spot-check (question q2)
  - Merge: Auto-merge when CI green

- [ ] **P2-03 Fix:** `get_banger_board` top-40 limit
  - Branch: `fix/largo-banger-board-top40`
  - Work: Filter to 40 candidates, maintain sorting
  - Validation: Phase 4 spot-check (question q4)
  - Merge: Auto-merge when CI green

### MEDIUM-TERM (Next 30-35 hours)

- [ ] **Measurement:** P3 truncation points (7 tools)
- [ ] **P3 Fixes:** Implement all 7 P3 truncations (3-6h each)
  - Same pattern: measure, fix, validate, merge
  - Parallel work: Can work on multiple fixes simultaneously

### FINAL (1 hour)

- [ ] **Phase 3 Re-run:** Full probe on main
  - Execute: `largo-truncation-probe.mjs --tools=all`
  - Expected: 129/129 COMPLETE, 0 unexpected truncations

- [ ] **Phase 4 Final:** Full integration test
  - Execute: `largo-comprehensive-validation.mjs --phase=all`
  - Expected: All criteria ≥80%

- [ ] **Phase 5 Final:** Performance baselines
  - Execute: Latency measurement script
  - Expected: p95 targets met

---

## SIGN-OFF CRITERIA

✓ All 10 truncation fixes merged and verified COMPLETE  
✓ Phase 4.1 answer quality: ≥80% completeness on 5 questions  
✓ Phase 4.2 cross-product: ≥80% factual agreement  
✓ Phase 4.3 citations: ≥95% claims traceable  
✓ Phase 4.4 stability: ≥90% coherence, ≥95% consistency  
✓ Phase 5: p95 TTFT <2s, p95 latency <12s  
✓ Final probe: 129/129 tools COMPLETE  

---

## NOTES

- Each fix is ONE issue per PR (per CLAUDE.md)
- Fixes auto-merge when CI passes (no manual approval needed)
- No regression: Phase 4 validation confirms quality unchanged after each fix
- Document in findings-staging/ only when fixing a real bug
- All commits to designated branch `claude/largo-53p3kg`

---

## REFERENCE COMMANDS

```bash
# Phase 4.1 validation
node --import tsx scripts/audit/largo-phase4-answer-quality.mjs --json

# Create a P2 fix branch
git checkout -b fix/largo-<issue-slug>

# Commit per CLAUDE.md template
git add .
git commit -m "fix(largo): <tool> truncation — <strategy>

Root cause: <one-line>
Evidence: Phase 3 probe TRUNCATED at <point>
Impact: <what agent can't do>

Fix: <Strategy A/B/C>
  - <specific API change>
  - <pagination or limit logic>

Testing:
  - Probe: tool now returns COMPLETE
  - Phase 4: representative question scores 80%+ completeness
  - Cross-product: no new disagreements

Fixes LARGO truncation #<N>

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_..."

# Push with auto-merge
git push -u origin fix/largo-<issue-slug>
# PR will auto-draft; coordinator marks ready when CI green
```

---

## STATUS HISTORY

| Date | Phase | Status | Note |
|------|-------|--------|------|
| 2026-08-23 | 1-3 | ✓ COMPLETE | All 129 tools probed, 10 truncations found |
| 2026-08-23 | 4-5 | ⏳ READY | Harnesses built, execution plan finalized |

