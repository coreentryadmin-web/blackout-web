# Largo Engine Capability Gaps — Phase 2c Analysis

> **kind:** FINDINGS

**Date:** 2026-08-29  
**Phase:** 2c — Engine Capability Gap Analysis (completed)  
**Status:** READY FOR PHASE 2d IMPLEMENTATION  

---

## Summary

Audit of Largo's 129 available tools across 8 TOOL_GROUPS identified **7 high-signal capability gaps** that would materially expand the engine's power and cross-product reasoning. These gaps explain user feedback that the agent "needs to be much more powerful" — the missing pieces are almost entirely cross-product comparison, real-time board composition, and multi-signal confluence.

**No bugs found.** All existing tools execute correctly; this audit found what's *absent*.

---

## 7 Identified Gaps (Prioritized)

### Priority P1 — Implement First (2-3 days, high signal, medium complexity)

#### 1. Multi-Product Ranking (Cross-Product Comparison)

**Gap:** Largo has no tool to compare the same setup across different products.

**User question it would answer:**
- "Which of {Night Hawk, Thermal, Vector, SPX, Helix, Meridian} has the best risk/reward for a similar setup today?"
- "How do recent earnings flows compare across tech stocks vs the SPX play?"
- "Is a multi-product hedge worth the cost today?"

**Implementation:** `get_cross_product_ranking`

```typescript
interface CrossProductRank {
  products: ("nighthawk" | "thermal" | "vector" | "spx" | "helix" | "meridian")[];
  metric: "edge" | "expected_value" | "confidence" | "win_rate" | "avg_win_pct";
  ranks: Array<{
    product: string;
    rank: number;
    score: number;
    evidence: string;  // "Live setup", "Historical WR", etc.
    confidence: number; // 0-1
  }>;
}
```

**Data sources:** Merge outputs from each product's native `get_*_outcomes` / `get_*_record` tools, normalize by metric.

**Blast radius:** Cross-product question volume; agent reasoning quality on multi-product decisions.

---

#### 2. Real-Time Multi-Product Board (Opportunity Aggregation)

**Gap:** Largo has no view of "what's setup-ready RIGHT NOW across all products?"

**User question it would answer:**
- "Give me the top 5 setups to work right now, across everything."
- "Any trades setting up in the next 30 minutes?"
- "What's the full universe view vs the Night Hawk board?"

**Implementation:** `get_live_multiproduct_board`

```typescript
interface LiveMultiProductBoard {
  as_of_et: string;  // "09:35 ET"
  refresh_interval_sec: number;
  setups: Array<{
    rank: number;
    product: string;
    ticker: string;
    setup_type: string;  // "0DTE call", "earnings flow", "sector momentum", etc.
    entry: number;
    target: number | null;
    stop: number;
    edge_pct: number;
    confidence: number;
    expires_at_et: string;
    live: boolean;
  }>;
}
```

**Data sources:** Real-time `get_open_plays` (Night Hawk) + `get_thermal_compare` + Vector open plays + SPX active + Helix tape + Meridian earnings.

**Blast radius:** Agent's ability to spot multi-product opportunities; user workflow (unified board vs separate product views).

---

### Priority P2 — Follow-Up (3-5 days each, medium signal, medium complexity)

#### 3. Earnings + Volatility + Flow Confluence (Entry Model)

**Gap:** Earnings reactions are measured in isolation; they don't merge with flow direction or regime context.

**User question it would answer:**
- "This stock has a 5% expected move but is the pre-market flow agreeing with that?"
- "Earnings setup: which products should I shade to, given current flow bias?"

**Implementation:** `get_earnings_flow_confluence`

Merges:
- `get_earnings_market` (expected move)
- `get_flow_tape` (direction + size)
- Current IV regime
- Historical reaction correlation

Output: Coherence score (0-1) and recommended entry direction if conflicting signals.

---

#### 4. Sector Momentum + Correlation (Rotation Detection)

**Gap:** Individual stock/sector analysis exists; cross-sector rotation (the regime that drives sector allocation) is unmeasured.

**User question it would answer:**
- "Tech is outperforming — is this a buy or a fade (mean revert)?"
- "Which sectors are rotationally safe if VIX spikes?"

**Implementation:** `get_sector_momentum_matrix`

Returns: 11×11 correlation matrix + recent winners/losers + rotation phase estimate.

---

#### 5. Cross-Product Risk Aggregation (Portfolio Greek View)

**Gap:** Individual products report greeks; Largo has no aggregated portfolio view.

**User question it would answer:**
- "What's my total gamma exposure across all open products?"
- "If VIX jumps 5, what's my blended portfolio loss?"

**Implementation:** `get_portfolio_risk_aggregate`

Sums:
- `get_gex` (SPX gamma)
- `get_greeks` (individual stock exposure)
- Each product's open plays' greeks

Output: Portfolio-level gamma/vega/theta + regime shocks (VIX +5%, -5%, etc.).

---

### Priority P3 — Backlog (1-2 weeks effort, medium/low signal, high complexity)

#### 6. ML Signal Detection (Historical Pattern Matching)

**Gap:** Largo identifies setups but has no memory of "setups like this one have worked before."

**User question it would answer:**
- "How often did this pattern (3% pre-market flow + tech earnings + VIX <20) win in the past?"
- "Is there edge in earnings + flow confluence, or is that just data dredging?"

**Implementation:** `get_similar_setups`

Requires:
- Historical Largo outcome DB (indexed by: pattern, setup_type, result)
- Pattern fingerprint function (flow direction × vol regime × earnings flag)
- Historical win rate by pattern

Output: Top N past setups matching current signature + pooled WR + confidence interval.

---

#### 7. Regime → Product Suitability (Product Selection)

**Gap:** "Which product is safest now?" is always a manual judgment.

**User question it would answer:**
- "In this high-VIX regime, should I focus on spreads (Helix) or stock momentum (Night Hawk)?"
- "Is this a 0DTE day or a swing day?"

**Implementation:** `get_regime_product_fit`

Measures historical product WR by regime (VIX band × vol term × earnings density) and recommends.

Output: Product fit scores + regime classifier + confidence.

---

## Technical Inventory

**129 total tools** across 8 TOOL_GROUPS:

| Group | Count | Example | Status |
|-------|-------|---------|--------|
| `spx_desk` | 12 | `get_spx_play`, `get_spx_structure` | Working; cross-product ranking needed |
| `flow_analysis` | 18 | `get_flow_tape`, `get_options_flow` | Working; confluence model needed |
| `stock_analysis` | 23 | `get_nighthawk_edition`, `get_vector_pulse` | Working; multi-product board needed |
| `vol_analysis` | 16 | `get_gex`, `get_gex_heatmap` | Working; portfolio aggregation needed |
| `news_events` | 22 | `get_earnings_market`, `get_catalysts` | Working; rotation detection needed |
| `fundamental` | 17 | `get_company_profile`, `get_financials` | Working |
| `platform` | 12 | `get_platform_snapshot`, `get_confluence_outcomes` | Working; real-time board needed |
| `screener` | 9 | `get_screener`, `get_banger_board` | Working |

**Gaps are not in quantity but in *synthesis*:** individual tools are deep and correct; the missing pieces are cross-product views.

---

## Effort & Signal Assessment

| Gap | Priority | Tools | Effort | Signal | Blocker |
|-----|----------|-------|--------|--------|---------|
| Multi-product ranking | P1 | 1 new | M | High | None |
| Real-time multi-product board | P1 | 1 new | M | High | None |
| Earnings + vol + flow confluence | P2 | 1 new (merges 4 existing) | M | Med | None |
| Sector momentum + correlation | P2 | 1 new | M | Med | None |
| Cross-product risk aggregation | P2 | 1 new (aggregates existing) | M | Med | None |
| ML signal detection (similar setups) | P3 | 1 new | L | Med | Outcome DB indexing |
| Regime → product suitability | P3 | 1 new | S | Med | Regime classifier |

**L = Large (1-2 weeks), M = Medium (3-5 days), S = Small (1-2 days)**

---

## Implementation Roadmap (Phase 2d)

### Week 1: P1 Gaps (Implement Both)

1. **`get_cross_product_ranking`** — Compare products on same setup dimension
   - Fetch each product's score for the input setup (shared fingerprint function)
   - Normalize by metric (EV, edge, confidence, etc.)
   - Rank and return

2. **`get_live_multiproduct_board`** — Real-time opportunity aggregation
   - Poll each product's open-plays endpoint
   - Rank by score/confidence/time-to-expiry
   - Return top 5-10

3. **Wire into tool-defs.ts + intent-keywords.ts**
   - Add to TOOL_GROUPS.platform or new group
   - Add intent keywords: "compare products", "what's setting up", "multi-product board"

### Week 2-3: P2 Gaps (In Priority Order)

1. Earnings + vol + flow confluence
2. Sector momentum + correlation matrix
3. Cross-product risk aggregation

### Future: P3 Gaps (Depends on Research)

- ML signal detection (needs outcome DB work)
- Regime classifier (needs historical regime scoring)

---

## Why These Gaps Matter

**User directive:** "Make it much more powerful."

Current Largo is excellent at **single-product depth** (one setup at a time, all the context). It's weak at **cross-product comparison** and **multi-signal synthesis**. The 7 gaps here fix exactly those two blind spots.

- **P1 + P2 together** would give Largo a "portfolio manager" view.
- **P1 + P2 + P3** would give Largo historical learning and regime sensitivity.

---

## No Regressions

This audit found no bugs or truncation in existing tools. All 129 tools are working correctly as of 2026-08-29. The fixes to 6 truncated tools (PR #3155, #3159) are verified deployed.

---
