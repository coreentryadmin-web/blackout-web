# 2026-08-29 — Largo engine capability gaps — PHASE 2C ROADMAP

> **kind:** `FINDING`

## Summary

Analysis of `src/lib/largo/tool-defs.ts` TOOL_GROUPS and intent-keyword routing identifies 7 high-signal capability gaps for cross-product reasoning, real-time board composition, and confluence-based entry modeling. These represent the "power-up" enhancements for Phase 2c and align with the directive to "make it much more powerful than what it can do today."

## Current Tool Groups (8 groups, 129 tools total)

**Strengths:**
- **spx_desk** (19 tools): Single-product SPX reasoning is strong (play state, flow, greek exposure, confluence)
- **flow_analysis** (18 tools): Multi-ticker flow coverage including merged HELIX tape + live UW
- **stock_analysis** (25 tools): Comprehensive single-ticker chart + derivatives analysis
- **vol_analysis** (7 tools): IV rank, term structure, regime
- **news_events** (12 tools): Earnings, catalysts, calendar
- **fundamental** (11 tools): Analyst ratings, insider flow, institutional holding
- **platform** (16 tools): Night Hawk edition, 0DTE plays, platform snapshot, BIE cross-product, Banger board
- **screener** (6 tools): Market-wide screening (movers, breadth, sector flow)

## Identified Gaps

### Gap 1: Multi-Product Ranking & Comparison (MISSING)

**Problem:** No tool answers "which product offers the best edge on NVDA right now?"
- `get_spx_vs_nighthawk_comparison`: Compares SPX and Night Hawk ONLY (hardcoded pair)
- No `get_thermal_vs_helix_comparison` or `get_vector_vs_*_comparison`
- No ranking across all 6 products (Night Hawk, Thermal, Vector, Helix, SPX, Meridian) by win-rate / EV / correlation

**Impact:** Cross-product questions default to composition ("ask each product separately") instead of unified reasoning

**Fix:** Implement `get_cross_product_ranking` tool that:
- Takes optional ticker filter
- Returns each product's edge/EV/confidence on that ticker
- Ranks by risk-adjusted return or consistency
- Explains the correlation between disagreements (e.g., why Helix bullish vs Thermal bearish)

---

### Gap 2: Real-Time Multi-Product Board (MISSING)

**Problem:** `get_platform_snapshot` shows platform STATE but no active multi-product board view
- Shows latest Night Hawk edition (static, one per day)
- Shows 0DTE plays (SPX only)
- Shows BANGER board (weekly bangers only)
- No tool that says: "right now, across ALL products, what are the TOP 5 setups?"

**Impact:** Members must jump between multiple product tabs to see the full opportunity set

**Fix:** Implement `get_live_multiproduct_board` that:
- Polls each product's real-time board (Night Hawk live session, Thermal heatmap, Vector pulse, etc.)
- Returns top 5-10 setups ranked by score + edge
- Includes product, ticker, entry, stop, target, confidence
- Refreshes every minute for RTH

---

### Gap 3: Earnings + Volatility + Flow Confluence (MISSING)

**Problem:** No dedicated tool that MERGES the three strongest entry signals
- Earnings calendars exist separately (get_earnings_market, get_earnings_calendar)
- Expected move is embedded in get_iv_term_structure
- Flow impact is in individual product tools
- No single "ideal entry setup" recommendation that considers all three

**Impact:** An earnings play with strong flow but elevated VIX lacks a unified confidence model

**Fix:** Implement `get_earnings_flow_confluence` that:
- Takes optional ticker and earnings date
- Returns: earnings expected move % + IV rank + live flow direction + historical win-rate on this setup
- Scores confluence (alignment of all three signals)
- Recommends product/strike/DTE based on confluence

---

### Gap 4: Sector Momentum + Cross-Sector Correlation (MISSING)

**Problem:** No tool for cross-sector questions
- `get_sector_flow` shows sector aggregate flow
- `get_market_breadth` shows sector ETF breadth
- No tool that answers: "which sectors are leading today AND have positive flow AND low correlation to QQQ?"

**Impact:** Sector rotation questions default to multiple tools instead of unified sector momentum model

**Fix:** Implement `get_sector_momentum_matrix` that:
- Returns all 11 sectors with: price momentum + flow + IV rank + correlation to SPX/QQQ
- Ranks by composite score
- Suggests sector pairs with diverging momentum (rotation setup)

---

### Gap 5: Machine Learning Signal Detection (MISSING)

**Problem:** No tool for pattern recognition across Largo's own history
- No "flag setups similar to the AAPL call that went 5x on 2026-08-15"
- No "this setup matches the Tuesday pattern 82% of the time"
- No learning from past Largo answer outcomes

**Impact:** Largo cannot build statistical confidence from its own track record

**Fix:** Implement `get_similar_setups` that:
- Takes a descriptor (ticker + product + timeframe + confluence level)
- Searches past Largo recommendations with similar parameters
- Returns historical win-rate, avg return, best/worst case
- Flags patterns that work (e.g., "flow + earnings consensus = 73% WR")

---

### Gap 6: Risk Aggregation Across Products (MISSING)

**Problem:** No tool for portfolio-level risk
- No "what's my total gamma exposure across all products?"
- No "which product should I trim to rebalance?"
- No cross-product correlation model for drawdown recovery

**Impact:** A member running multiple products cannot see aggregate risk without manual calculation

**Fix:** Implement `get_portfolio_risk_aggregate` that:
- Takes list of open products + positions
- Returns: total gamma, vega, theta exposure
- Calculates correlation between products
- Recommends which product to trim based on correlation (hedge, not double-down)

---

### Gap 7: Product Suitability by Regime (MISSING)

**Problem:** No tool that says "in THIS market regime, which product is safest?"
- Market regime exists (get_market_regime)
- Product-specific regimes exist per product
- No unified model for "high-VIX risk-off → SPX Sniper is SAFE, Thermal is RISKY"

**Impact:** Regime transitions default to anecdote instead of data-driven product selection

**Fix:** Implement `get_regime_product_fit` that:
- Takes current market regime (or derives it)
- For each product, returns: historical win-rate in this regime + current setup quality + recommendation
- Suggests which product to prioritize based on regime

---

## Secondary Gaps (Lower Priority)

- **Cross-ticker flow leaderboard with product breakdown** (minor: `get_postgres_flows` exists for raw tape)
- **Options IV crush impact model** (minor: IV term structure exists)
- **Futures-based hedging recommendations** (out of scope: only cash options covered today)

## Implementation Roadmap

| Gap | Priority | Effort | Tools | Notes |
|---|---|---|---|---|
| Gap 1: Multi-Product Ranking | P1 | M | 1 new tool | High-signal, medium implementation |
| Gap 2: Real-Time Multi-Product Board | P1 | L | 1 new tool + aggregation | Requires product state polling |
| Gap 3: Earnings + Vol + Flow | P2 | M | 1 new tool | Merges existing data, new scoring |
| Gap 4: Sector Momentum + Correlation | P2 | M | 1 new tool | Re-uses `get_sector_flow` + breadth |
| Gap 5: ML Signal Detection | P3 | L | 1-2 new tools | Requires historical Largo outcome DB |
| Gap 6: Risk Aggregation | P2 | M | 1 new tool | Portfolio-level gamma/vega model |
| Gap 7: Regime-Product Fit | P3 | S | 1 new tool | Scoreboard approach |

## Status

**Status: MAPPED & PRIORITIZED** (no changes to code; roadmap documented for Phase 2c implementation sprint)

---
