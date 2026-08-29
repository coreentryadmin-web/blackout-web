# Phase 2d Implementation Plan — P1 Tools

**Date:** 2026-08-29
**Status:** Design phase (implementation starting after Phase 2b validation)

## P1 Tools (High Signal, 2-3 days, Implement First)

### 1. `get_cross_product_ranking` — Compare same setup across products

**Purpose:** Answer questions like "Which product has the best risk/reward for this setup?"

**Interface:**
```typescript
// Input: setup fingerprint
{
  ticker: string;
  entry_price: number;
  direction: "call" | "put" | "bull" | "bear";
  timeframe: "0dte" | "weekly" | "monthly" | "earnings" | "sector";
  metric: "edge" | "expected_value" | "win_rate" | "confidence" | "avg_win_pct";
}

// Output: ranked comparison
{
  products: Array<{
    product: "nighthawk" | "thermal" | "vector" | "spx" | "helix" | "meridian";
    rank: number;
    score: number;
    evidence: string; // "Live 0DTE setup", "Historical WR", "Current flow", etc.
    confidence: number; // 0-1
    data_source: string; // which tool was queried
  }>;
  as_of_et: string;
  note: string; // any caveats about missing products or incomplete data
}
```

**Data Sources per Product:**
- **Night Hawk (0DTE):** `get_nighthawk_outcomes` (track record) + `get_open_plays` (live setups)
- **Thermal (GEX/Greeks):** `get_positioning` + `get_greeks` (dealer positioning)
- **Vector:** `get_vector_full_state` (wall-to-price structure) + `get_vector_analytics` (technical confluence)
- **SPX Slayer:** `get_spx_play` (current play + confluence factors) + `get_trade_history` (win rate)
- **Helix (Earnings):** `get_earnings_market` (expected move) + historical calibration
- **Meridian:** `get_meridian_timeline` (event framework + historical reactions)

**Implementation Steps:**
1. Define the input/output interfaces
2. Create a per-product score extraction function (normalize each product's native metric)
3. Implement rank ordering and tie-breaking
4. Add fitting function to stay under transport cap (top 5-6 products max)
5. Wire into tool-defs.ts under TOOL_GROUPS.platform
6. Add test fixtures for major products

**Complexity:** Medium — mostly aggregation/normalization, no new calculations

---

### 2. `get_live_multiproduct_board` — Real-time aggregated opportunity board

**Purpose:** Answer "Give me the top N setups to work on RIGHT NOW across all products"

**Interface:**
```typescript
// Input: ranking preference
{
  metric: "edge" | "confidence" | "urgency" | "score"; // default "score"
  limit: number; // default 5, max 10
  hours_ahead: number; // default 0 (current), max 6 (look-ahead)
}

// Output: unified board
{
  as_of_et: string;
  refresh_interval_sec: number;
  setups: Array<{
    rank: number;
    product: string;
    ticker: string;
    setup_type: string; // "0DTE call", "earnings flow", "sector momentum", "gamma flip", etc.
    direction: "bull" | "bear" | "neutral";
    entry_level: number;
    target_level: number | null;
    stop_level: number;
    edge_pct: number | null;
    confidence: number; // 0-1
    expires_at_et: string;
    live: boolean;
    rationale: string; // one-line reason it's ranking high
  }>;
  truncated: boolean;
  note: string;
}
```

**Data Sources:**
- **Night Hawk:** `get_open_plays` (live 0DTE board)
- **Thermal:** `get_thermal_compare` (active setups)
- **Vector:** `get_vector_full_state` (active walls/plays) + `get_vector_pulse` (real-time changes)
- **SPX Slayer:** `get_spx_play` (current play)
- **Helix:** `get_helix_signal_outcomes` (active signals)
- **Meridian:** `get_meridian_timeline` (earnings setups active in current window)

**Implementation Steps:**
1. Define per-product "is setup live" checkers
2. Extract setup details from each product's native schema
3. Implement cross-product ranking/scoring
4. Add expiry/urgency calculations
5. Sort and truncate to limit
6. Add fitting function to stay under cap (top 5-10 setups)
7. Wire into tool-defs.ts under TOOL_GROUPS.platform
8. Add test fixtures

**Complexity:** Medium — real-time data aggregation, moderate complexity

---

## Implementation Sequence

1. **Phase 2b Validation** (Today) — Answer quality baseline probe
2. **Tool Definitions** (Evening) — Add both P1 tools to tool-defs.ts
3. **run-tool.ts Implementation** (Day 2) — Write handlers, data extraction, scoring
4. **Testing & Validation** (Day 3) — Live testing, adjust caps, verify output quality
5. **Merge & Deploy** (End of Day 3)
6. **P2 Tools Planning** (Ongoing) — Sketch out P2-3 designs in parallel

---

## Integration Points

### tool-defs.ts Changes:
- Add two new tool definitions with detailed descriptions
- Add both to TOOL_GROUPS.platform
- Add both to LARGO_SYNTHESIS_TOOLS (cross-product reasoning group)

### run-tool.ts Changes:
- Implement case for each tool
- Import product-specific fetchers (already exist: fetchNighthawkOutcomes, fetchSpxPlay, etc.)
- Implement scoring/ranking logic
- Wire up fitRowsToBudget for size control

### New Support Files:
- `src/lib/largo/cross-product-ranking.ts` — Scoring logic
- `src/lib/largo/multiproduct-board.ts` — Board aggregation logic
- Tests in each file

---

## Risk Mitigation

1. **Tool Result Cap:** Use `fitRowsToBudget` from day one, not fixed counts (learned from #3166)
2. **Product Data Freshness:** Each tool result includes `as_of_et` and `data_source` to surface staleness
3. **Missing Products:** Gracefully omit products with no live data rather than erroring
4. **Score Stability:** Scoring logic should not change product opinions based on which other products answered (avoid cascading rank shifts)

---

## Definition of Done

- [ ] Both tools pass `npm test` with Node 20
- [ ] Both tools pass tsc/eslint
- [ ] Real-world testing (live queries against prod)
- [ ] Result payloads verified under 16KB transport cap
- [ ] Findings staged and ready to fold
- [ ] Merged to main and deployed

