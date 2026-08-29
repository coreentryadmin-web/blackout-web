# 2026-08-29 — Largo Phase 2 Certification Completion

> **kind:** `FINDING`

## Phase 2 Summary: Answer Quality & Engine Enhancement Roadmap

**Completed:** Truncation certification (9 tools probed, 6 fixed); engine capability gaps mapped for power-up.

---

## Phase 2a: Truncation Certification — COMPLETE

### Status: ✅ COMPLETE (6 tools fixed & deployed)

**Truncation probe run 2026-08-29 (probed 9 tools):**

| Tool | Status 2026-08-23 | Probe 2026-08-29 | Fix Applied | Deployment |
|---|---|---|---|---|
| `get_confluence_outcomes` | ANALYZING | TRUNCATED | ✅ Cap 30/product | ✅ main commit 60fb702a0 |
| `get_platform_snapshot` | ANALYZING | TRUNCATED | ✅ Cap flows 20 | ✅ Deployed |
| `get_market_oi_change` | ANALYZING | TRUNCATED | ✅ Cap 20 entries | ✅ Deployed |
| `get_market_stats` | ANALYZING | TRUNCATED | ✅ Major indices only | ✅ Deployed |
| `get_group_greek_flow` | ANALYZING | TRUNCATED | ✅ Cap 15 groups | ✅ Deployed |
| `get_screener` | ANALYZING | TRUNCATED | ✅ Cap 15 candidates | ✅ Deployed |
| `get_nighthawk_dossier` | ANALYZING | COMPLETE | — (already fixed) | — |
| `get_analyst_ratings` | ANALYZING | COMPLETE | — (already fixed) | — |
| `get_market_context` | ANALYZING | COMPLETE | — (PR #3038) | — |

**Fixing approach (product-first design):**
- Created 3 fitting function files: `confluence-outcomes-fit.ts`, `platform-snapshot-fit.ts`, `market-data-fits.ts`
- Modified `run-tool.ts` to apply fittings at Largo boundary only (model receives capped data; products use full data)
- Each fitted result includes explicit `shown`, `truncated`, `max_shown` fields for model transparency
- All changes merged to main (PR #3155, commit 60fb702a0) and deployed to production

**Validation:**
- ✅ npm run build: exit 0 (no TS errors)
- ✅ GitHub CI verify: success (all required checks green)
- ✅ Code deployment: confirmed on origin/main
- ⏳ Re-run truncation probe post-deployment: pending (requires Clerk auth setup)

---

## Phase 2b: Vague Response Audit — PARTIAL

**Objective:** Hunt hedged/uncertain language; measure answer quality ≥80%

**Attempted:** `largo-answer-quality-probe.mjs` failed (missing prod Clerk session env)

**Root cause:** Probe requires `mintClerkPremiumSession()` for live auth to production; sandbox requires explicit Clerk credentials passed in.

**Status:** Deferred (requires operator-provided prod Clerk token or environment setup). The probe exists and is documented; can be re-run once credentials are configured.

**Tools available for manual/later runs:**
- `largo-answer-quality-probe.mjs` — answer quality ≥80%
- `largo-phase4-answer-quality.mjs` — cross-product answer quality
- `largo-truth-divergence.mjs` — cross-product disagreement
- `largo-absence-scan.mjs` — absence representation
- `spx-largo-confidence-probe.mjs` — SPX confidence calibration
- `largo-comprehensive-validation.mjs` — full system validation

---

## Phase 2c: Engine Capability Gaps — COMPLETE

**Objective:** Identify missing tools for cross-product reasoning and power-up enhancements

**Method:** Analyzed `src/lib/largo/tool-defs.ts` TOOL_GROUPS (129 tools across 8 groups) against stated use cases

**Findings: 7 High-Signal Capability Gaps**

| # | Gap | Priority | Type | Notes |
|---|---|---|---|---|
| 1 | Multi-product ranking & comparison | P1 | Missing tool | Compare products (Night Hawk/Thermal/Vector/SPX/Helix/Meridian) by edge/EV/confidence |
| 2 | Real-time multi-product board | P1 | Missing tool | Single view of top 5-10 setups across ALL products, updated every minute |
| 3 | Earnings + Vol + Flow confluence | P2 | Missing tool | Merge expected move + flow impact + historical WR into single entry score |
| 4 | Sector momentum + correlation | P2 | Missing tool | Cross-sector rotation setup detection (which sectors leading? correlation to SPX/QQQ?) |
| 5 | ML signal detection / pattern matching | P3 | Missing tool | Flag Largo's own past setups that worked; historical win-rate per pattern |
| 6 | Cross-product risk aggregation | P2 | Missing tool | Portfolio gamma/vega/theta; correlation-based rebalance recommendations |
| 7 | Regime → product suitability | P3 | Missing tool | "In high-VIX risk-off regime, which product is safest?" |

**Implementation roadmap:** Documented in `2026-08-29-largo-engine-capability-gaps.md`
- P1 items (2 tools): High signal, medium effort
- P2 items (3 tools): Medium signal, medium effort  
- P3 items (2 tools): Lower signal, larger effort (ML requires historical outcome DB)

---

## Phase 2d: Engine Power-Up Implementation — NOT YET STARTED

**Scope:** Implement 7 tools identified above in priority order (P1 first)

**Next steps:**
1. Implement Gap 1 (`get_cross_product_ranking`): Product comparison at decision point
2. Implement Gap 2 (`get_live_multiproduct_board`): Real-time opportunity aggregation
3. Implement Gap 3 (`get_earnings_flow_confluence`): Entry model merge
4. Gate on Phase 2b results (vague response audit) to understand current answer quality baseline

---

## Session Deliverables

**Files Created:**
- `src/lib/largo/confluence-outcomes-fit.ts` — fits confluence outcomes to 30 per product
- `src/lib/largo/platform-snapshot-fit.ts` — fits platform snapshot flows to 20
- `src/lib/largo/market-data-fits.ts` — fits 4 market data tools (OI change, stats, greek flow, screener)
- `docs/audit/findings-staging/2026-08-29-largo-nighthawk-dossier-complete.md`
- `docs/audit/findings-staging/2026-08-29-largo-analyst-ratings-complete.md`
- `docs/audit/findings-staging/2026-08-29-largo-market-context-fit-applied.md`
- `docs/audit/findings-staging/2026-08-29-largo-truncation-6-tools-fix.md`
- `docs/audit/findings-staging/2026-08-29-largo-engine-capability-gaps.md` ← This document

**Files Modified:**
- `src/lib/largo/run-tool.ts` — apply all 6 fitting functions at Largo boundary

**Commits:**
- Commit 4e152fd10 (PR #3155, later squashed as 60fb702a0): Fix 6 Largo truncation issues + create 3 fitting files

**PR:**
- #3155: Merged, deployed to production

---

## Next Actions (Per Phase 2 Directive)

1. ✅ Complete truncation certification → DONE
2. ✅ Fix remaining truncations → DONE (6 tools)
3. ⏳ Hunt vague responses → PENDING (audit infrastructure, not code changes)
4. ✅ Identify capability gaps → DONE (7 gaps mapped)
5. ⏳ Implement power-up enhancements → NOT YET (roadmap complete, implementation pending)

**Critical path forward:** Phase 2b (vague response audit) and Phase 2d (implement P1 gaps) can proceed in parallel once Phase 2b auth is resolved.

---
