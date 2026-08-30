# HELIX Product Strategy & Improvements

## Executive Summary
HELIX is a 24-component institutional flow intelligence dashboard with strong core tape + signal detection, but lacks the **calibration, cross-product integration, and analytical depth** that would make it a primary trading instrument rather than a confirmation tool.

## Current Architecture (Verified from Code)

### Panel Categories (24 components)
1. **Tape Panels** (6): FlowTape, Tape Row, Tape Header, Sort Manager, Row Density, Cell Renderers
2. **Analytics Panels** (8): CumulativeNetPremium, ContractDrilldown, Premium Distribution, Strike Distribution, Expiry Distribution, Direction Distribution, Time Series, Volume Profile
3. **Signal Detection** (3): Velocity Spike, Split Flow, Eligibility Checks
4. **Controls & UI** (7): Filters (Premium/DTE/Type/Watchlist/Route/Sector), Deep Linking

### Core Strengths
- **16-column table** with density-based visibility (essential/standard/full)
- **Signal detection** for velocity spikes and split flow patterns
- **Real-time SSE** for live updates
- **Deep linking** for bookmarkable states
- **Responsive grid layout** with minmax() for mobile/desktop

### Known Limitations (from Phase 1 audit)
- **Conviction score does NOT rank directional follow-through** (measured as "SPREAD WITHOUT ORDER" at every horizon)
- **No temporal context** — prints isolated from market conditions
- **No Greeks aggregation** — only price-based analysis
- **No flow history** — tape is ephemeral, no replay
- **No alerts** — passive viewing only
- **Limited Largo integration** — score not exposed to AI layer

---

## Tier 1: High-Impact, Low-Complexity (DO FIRST)

### 1. **Conviction Score Calibration** ⭐ CRITICAL
**Problem**: Score claims "notability heuristic: order size + sweep/0DTE flags" but measures as non-ranking.  
**Impact**: Users cannot distinguish $10M sweep from $1M sweep by conviction; false confidence.  
**Implementation** (2–3 days):
- Add measured tier/percentile: `score_tier` = "common"/"notable"/"rare" based on session-wide distribution
- Surface actual p-values in drilldown: "This premium is top 5% for SPY calls this session"
- Calibrate against Polygon minute-bar directional follow-through (do 30-minute continuation, rank by score quartile)
- Add `calibration_status` field: "live" (today's data) vs "historical" (generic) vs "uncalibrated"

**Files to modify**:
- `src/lib/helix/conviction-score.ts` — add percentile + tier logic
- `src/features/helix/components/FlowTape/CellRenderers.tsx` — render score with tier color
- `src/features/helix/lib/helix-table-columns.ts` — update Score column hint

**Evidence to collect**: Run `scripts/audit/helix-score-signal.mjs` against 7-day window; measure direction agreement by quartile.

---

### 2. **Flow History Panel** ⭐ CRITICAL  
**Problem**: Tape is ephemeral; no way to replay intraday flow or spot patterns (e.g., "this ticker had 3 sweeps in the first 30 min").  
**Impact**: Users cannot learn from the session or debug missed trades.  
**Implementation** (2–3 days):
- Add "History" tab to ContractDrilldown: vertically-scrollable timeline of ALL prints for `[ticker, side, strike, expiry]`
- Show time, premium, volume, signals (velocity/split), direction, marked outcome (if graded)
- Cache as Redis sorted set `helix:flow:history:{ticker}:{side}:{strike}:{expiry}` for 24h
- Add scrubber to FlowFeed: "Show flow from X to Y ET" (default: RTH)

**Files**:
- New: `src/features/helix/components/FlowHistory.tsx`
- `src/features/helix/components/ContractDrilldownDrawer.tsx` — add History tab
- `src/lib/helix/flow-history-query.ts` — Redis fetch + pagination

**Data** already exists: board snapshots are stored; replay is a viewport + filter on existing data.

---

### 3. **DTE + IV Context Row** ⭐ CRITICAL  
**Problem**: Each print is isolated; no context for "is IV high/low today?" or "how deep is 0DTE chain?"  
**Impact**: User cannot judge sweep magnitude without manual chain lookup.  
**Implementation** (1–2 days):
- Add sticky context row above tape: "SPY call 0DTE IV: 23.4% (↑12% from open) | chain depth: 847 OI | spot: $487.23"
- Fetch from Polygon real-time chain (already available in `/heatmap` path)
- Update on each print via SSE (high-water IV, fresh spot, summed OI)
- Link "chain depth" to `/heatmap?ticker=SPY` for full ladder

**Files**:
- New: `src/features/helix/components/HelixContextHeader.tsx`
- `src/features/helix/lib/helix-context-query.ts` — Polygon chain fetch

---

### 4. **Export to CSV / Clipboard** ⭐ QUICK WIN  
**Problem**: No way to bulk-analyze flow (e.g., in Excel, backtest setup).  
**Impact**: Forces manual copy/paste of each tape row.  
**Implementation** (1 day):
- Add "Export" button to tape header: export visible rows as CSV (time, ticker, side, strike, expiry, premium, signals)
- "Copy as JSON" for programmatic use
- Include applied filters in export (so subset is reproducible)

**Files**:
- `src/features/helix/components/FlowFeed.tsx` — add export button
- New: `src/lib/helix/export-tape.ts` — CSV/JSON serialization

---

## Tier 2: High-Impact, Medium-Complexity (NEXT PRIORITY)

### 5. **Execution Analysis Panel**  
**Problem**: Tape shows print details but not execution quality (filled vs ask, spread paid, etc.).  
**Impact**: Cannot distinguish retail FOMO from institutional entry; limits signal value.  
**Implementation** (3–4 days):
- Add column "Ask%" (already in columns.ts but not rendered?): % of premium paid at/above ask
- Add drilldown details: "filled $2.47 on $2.50 ask" vs "filled $0.10 below ask"
- Surface UW's `execution_quality` field if available (execution bias toward aggressive/conservative)

**Files**:
- `src/features/helix/lib/helix-table-columns.ts` — verify Ask% is exported
- `src/features/helix/components/FlowTape/CellRenderers.tsx` — render Ask% with color gradient
- Drilldown: add Execution tab with fill detail

---

### 6. **Session Correlation Matrix**  
**Problem**: No way to spot tickers that move together (e.g., "when SPY sweeps call, QQQ usually follows within 5 min").  
**Impact**: Traders miss correlated flow setup chains.  
**Implementation** (4–5 days):
- Add "Patterns" panel: "Ticker Pairs" tab
- For each ticker with 2+ prints, measure correlation with all others (time-lagged 5/10/15 min)
- Render heatmap: correlation strength, time lag, direction agreement (both bullish/bearish)
- Link to flows: "3 correlated SPY → QQQ sweeps today" → show all three on same chart

**Data**:
- Requires flow ledger (board snapshots); measure direction + time for each name
- Spearman rank correlation (simple, robust)

---

### 7. **Flow Clustering** (Unusual Whales Origin Tagging)  
**Problem**: Cannot distinguish coordinated flow from random noise (e.g., "is this single buyer or 5 buys in rapid succession?").  
**Impact**: Overweights single large print; misses coordinated campaigns.  
**Implementation** (3–4 days):
- Add UW integration: tag prints by UW's internal `origin_id` or clustering (if available)
- Render visual grouping: print rows with same origin slightly indented/highlighted
- Add filter: "Show clustered flow only" (hide singleton prints)
- Badge: "5-print sweep" (when prints group into one logical order)

**Files**:
- `src/features/helix/lib/helix-flow-format.ts` — add `origin_cluster_id` field
- Tape row styling: indent/highlight by cluster
- Filters: add "Cluster Size" filter

---

## Tier 3: Nice-to-Have (POLISH)

### 8. **Volume Profile Overlay**  
Add Polygon-sourced intraday volume profile (price ladder by volume) as background to premium distribution chart.

### 9. **Alerts** (Email/Push/Webhook)  
"Notify me when SPY calls see $>50M premium in <5 min" — requires persistence layer (DB trigger).

### 10. **Sector & Market Regime Context**  
Add ribbon at top: "XLK +2%, VIX +8%, Bond yields +15bp" — links to why flow is happening.

### 11. **Meridian Link**  
When earnings print detected, auto-link to Meridian drilldown with IV term structure + expected move.

### 12. **Vector Integration**  
"This ticker gapped >2.5% this week" badge on flow rows (reuse Vector's gap detection).

---

## Implementation Roadmap

### Sprint 1 (Weeks 1–2): Calibration + Context
- **#1 Conviction Score Calibration** (tier 1, critical signal reliability)
- **#3 DTE + IV Context Row** (tier 1, decision-making context)
- **Validation**: Run `helix-score-signal.mjs` post-deploy; confirm score now separates direction

### Sprint 2 (Weeks 2–3): History + Export
- **#2 Flow History Panel** (tier 1, learning + debugging)
- **#4 Export to CSV** (tier 1, integration)
- **Validation**: Users can replay 1-hour window; export round-trips as CSV

### Sprint 3 (Weeks 3–4): Analytics Depth
- **#5 Execution Analysis** (tier 2, signal quality)
- **#6 Session Correlation** (tier 2, pattern recognition)
- **Validation**: Backtest: do correlated prints predict follow-through better?

### Sprint 4 (Weeks 4–5): Clustering + Polish
- **#7 Flow Clustering** (tier 2, noise filtering)
- **#8–12 Nice-to-Haves** (tier 3, UX polish)

---

## Measurement Framework

| Improvement | Success Metric | Baseline | Target |
|---|---|---|---|
| #1 Conviction Score | Direction correlation (Spearman ρ) by tier | 0.0 (non-ranking) | ≥+0.35 (top tier) |
| #2 Flow History | User engagement (drilldown opens) | n/a | +40% vs before |
| #3 Context Row | Chart adjustments after viewing context | n/a | +25% users click to `/heatmap` |
| #4 Export | Bulk analysis frequency | 0/session | ≥2/day (active users) |
| #5 Execution Analysis | User preference (A/B: with/without Ask%) | n/a | +30% users keep it visible |
| #6 Correlation Matrix | Trade setup chains captured | 0 | ≥5/day identified |
| #7 Clustering | Noise-to-signal ratio | 1:1 (unmeasured) | 1:2.5 (clustering reduces false positives) |

---

## Cross-Product Alignment

### Vector Synergy
- Vector finds breakout movers; HELIX shows their flow precursors
- **Link**: "This stock is top 3 banger candidates" → link to HELIX flow for that day

### Meridian Synergy  
- Meridian tracks earnings; HELIX shows pre-earnings flow accumulation
- **Link**: "SPY calls spiked 2h before earnings" badge in Meridian drilldown

### Thermal Synergy
- Thermal ranks volatility; HELIX shows volatility creation flows
- **Link**: "Thermal marked this vol high 10 min after these sweeps"

### Night Hawk Synergy  
- Night Hawk commits 0DTE plays; HELIX shows the intraday flow that supported them
- **Cross-validate**: "Score claimed notable; did play win?" (conviction → outcome feedback loop)

---

## Open Questions (Validation Gate)

1. **Conviction Score**: Does top-quartile conviction actually outperform in direction? (Run `helix-score-signal.mjs` 7-day)
2. **Flow Clustering**: Does UW expose cluster/origin IDs, or must we invent them? (Check UW API schema)
3. **Correlation Matrix**: Does cross-ticker correlation add win-rate at position size that justifies the compute? (A/B test)
4. **History Retention**: How long should tape history persist? (24h is conservative; could be session-only)

---

## Non-Negotiable Principles

1. **No invented signals.** If a field measures as non-ranking, surface that rather than inventing confidence. (Reason: `CLAUDE.md` Largo product contract §2: fabricated certainty corrupts cross-product ranking.)
2. **Keep tape fast.** Add features as opts-in tabs, not table columns (too many columns collapse usability). History should load on-demand.
3. **Measure before shipping.** Every improvement must have a before/after calibration (direction agreement, user engagement, latency).
4. **Export as feature parity.** CSV export can be V1 (static); V2 can add formulas, filters, live refresh.

