# Cross-Product Largo Testing Guide

## Adversarial Question Bank

Product owner stress-test for the new cross-product tools (`get_cross_product_ranking`, `get_live_multiproduct_board`).

### Tier 1: Basic Functionality

These should always work and produce ranked results:

- **"Which desk has the best 0DTE setup on SPX right now?"**
  - Should call `get_cross_product_ranking` with ticker=SPX, timeframe=0dte, metric=edge
  - Should rank Night Hawk, Thermal, Vector, SPX Slayer, Helix, Meridian
  - Should mention which desk ranks #1 and why
  - ✓ Pass if: Ranked all 6 products, explained top product's edge
  - ✗ Fail if: Only 5 products shown, Meridian missing, hallucinated edge numbers

- **"Rank all desks by confidence on a weekly NVDA call."**
  - Should call `get_cross_product_ranking` with ticker=NVDA, direction=call, timeframe=weekly, metric=confidence
  - Should explain relative confidence scores (% or relative comparison)
  - Should note data freshness (e.g., "Thermal at 1m old, Helix at 2h old")
  - ✓ Pass if: All 6 products ranked, confidence explained, freshness noted
  - ✗ Fail if: Missing products, no confidence values, hallucinated freshness

- **"Show me the top 5 trading opportunities right now across all desks."**
  - Should call `get_live_multiproduct_board` with metric=score (default), limit=5
  - Should show ticker, product, setup type, entry/target/stop, expiry
  - Should rank by edge + confidence + freshness (composite score)
  - ✓ Pass if: 5 setups shown with all required fields, ranked sensibly
  - ✗ Fail if: Missing fields, rank order nonsensical, only 4 products shown

### Tier 2: Edge Cases & Graceful Degradation

These test "honest I don't know" behavior:

- **"Cross-product ranking for $0.02 penny stock AABB"**
  - Most desks have no data on penny stocks (SPX Slayer only trades SPX, Thermal needs options chain)
  - Should either:
    - Return 1-2 products that CAN score it (e.g., Helix if it's near earnings)
    - Explicitly say "No pricing data available" rather than hallucinate
  - ✗ Fail if: Returns 6 products with fabricated scores, or crashes

- **"Which desk agrees most on QQQ earnings?"**
  - Only Helix/Meridian should have strong opinions on earnings
  - Night Hawk/Vector/Thermal may have weaker signals
  - Should say "Helix and Meridian agree, confidence 0.8" or similar
  - ✗ Fail if: Asserts all 6 desks have earnings positions equally

- **"Compare multiproduct board by 'expected_value' metric"**
  - Only Night Hawk/SPX Slayer measure E[V] directly
  - Other desks use proxies (dealer gamma → edge estimate, etc.)
  - Should say "using available edge proxies" rather than lying about E[V]
  - ✗ Fail if: Missing metric → crashes instead of graceful fallback

### Tier 3: Conflicting Signals

These test cross-product disagreement handling:

- **"Vector says bearish but Thermal says bullish on IWM. Which do I trust?"**
  - Perfectly reasonable for desks to disagree (Vector is structure, Thermal is dealer positioning)
  - Should NOT pick a winner arbitrarily
  - Should explain WHY they differ: "Vector sees S&R walls; Thermal sees large dealer puts"
  - ✗ Fail if: Returns one winner without explaining disagreement

- **"Do Night Hawk and Helix agree on this week's earnings plays?"**
  - Night Hawk: near-term 0DTE/weekly plays, based on live signals
  - Helix: earnings calendar + historical reaction patterns, no live plays
  - Agreement/disagreement is expected; both are correct
  - ✗ Fail if: Treats disagreement as one desk being "wrong"

### Tier 4: Thin/Stale Data

These test freshness and confidence calibration:

- **"What's the highest-confidence cross-product setup RIGHT NOW?"**
  - Night Hawk: 0-5 minutes old (live board)
  - Thermal: 0-2 minutes old (dealer positioning refreshes constantly)
  - Vector: 0-30 seconds old (spot walls)
  - Helix/Meridian: 1-120 minutes old (earnings data static)
  - Should pick something from the fresh products (NH/Thermal/Vector), not stale earnings
  - ✗ Fail if: Picks a 3h-old Helix setup as "highest confidence right now"

- **"Multiproduct board by urgency for expiries within 2 hours"**
  - Input: `hours_ahead: 2`
  - Should filter to setups expiring in next 2 hours
  - Mostly 0DTE plays (Night Hawk, some Thermal)
  - Should say "No setups expiring in 2h" if it's after-hours (honest)
  - ✗ Fail if: Returns earnings plays with 6-month expiries

### Tier 5: Transport & Completeness

These test for truncation and hidden failures:

- **"Compare all 6 desks on SPX with full explanation."**
  - Cross-product ranking should return all 6 ranked products
  - Not truncated to 3 products due to transport cap
  - Should include confidence + freshness on ALL products, not "first 5"
  - ✗ Fail if: Only 3 products served, rest silently omitted

- **"Multiproduct board limited to top 3."**
  - Input: `limit: 3`
  - Result should say `shown: 3, total_available: X, truncated: true/false`
  - Should NOT silently show only 1-2 products due to tool failures
  - ✗ Fail if: Says `total_available: 0` (no attempt made) or `shown: 2` (partial failure hidden)

## What to Look For

### Crash/Hang Indicators
- Timeout on question (>30s — likely infinite loop or blocking tool)
- HTTP 500 (tool or ranking function errored)
- Partial/corrupted JSON in response

### Hallucination Indicators
- 6 products ranked when 3 have no data (should skip failed products, not invent)
- Confidence "0.95" on data that was "stale 120 minutes ago"
- Edge numbers that don't match product's own numbers (e.g., Night Hawk said 8.5%, cross-product says 2.1%)
- "Product X agrees with product Y" when Largo never called both

### Graceful Degradation Failures
- Question that SHOULD result in "insufficient data" instead returns confident wrong answer
- Single desk down → full cross-product board crashes (should show 5/6)
- Thin-data ticker → hallucinated per-product scores instead of "no data available"

### Confidence Calibration Issues
- "Confidence 0.9" on 2-hour-old earnings data (should be 0.5-0.6)
- All products show same confidence regardless of freshness
- "Confidence 0.3" on live real-time data (should be 0.8+)

### Freshness Issues
- Board says "all fresh, updated 5min ago" but Helix data is 12h old
- Multiproduct ranking omits freshness_minutes field (should have it)
- No distinction between live data (NH, Thermal) and calendar data (Helix, Meridian)

## Running the Tests

### Option 1: Live Harness (Production)
```bash
node --import tsx scripts/audit/largo-stress-suite.mjs --only=cross-product \
  --base=https://blackouttrades.com --json
```

### Option 2: Specific Questions
Use the `largo-live-probe.mjs` harness with custom questions:
```bash
node --import tsx scripts/audit/largo-live-probe.mjs \
  "Which desk ranks highest on SPX 0DTE by edge?" \
  "Top 5 setups across all desks by urgency?"
```

### Option 3: Manual Testing
1. Go to `/terminal` in the app
2. Ask: "Compare Night Hawk vs Thermal on QQQ 0DTE"
3. Check that BOTH desks appear in ranking, with distinct reasons
4. Note freshness values (should differ: Thermal 1m, NH might be 5m)

## Success Criteria

A cross-product feature is production-ready when:
1. **All 6 desks included** (or only skipped when data provably unavailable)
2. **Graceful degradation** (missing data → honest "insufficient", not crash/hallucination)
3. **Confidence calibrated** (reflects data age and source reliability)
4. **Freshness transparent** (every product/setup shows its age)
5. **No transport truncation** (all products ranked, not just top 3)
6. **Disagreement explained** (why Vector says X and Thermal says Y)

Incomplete: Product returns 5/6 desks, confidence uncalibrated, or silently omits stale data.

Broken: Crashes on edge case, hallucinates missing data, or conflates disagreement with error.
