# PR: Add Chain Truncation Indicator to Heatmap

**Issue:** Thin/low-priced names escalate to full chain or get capped; walls/OI understated. `warnChainTruncated` exists server-side but doesn't surface to UI.

**Root cause:** When a ticker has <50 strikes in the narrow band or very thin option chains, the builder uses a fallback (full chain or capped at 100 strikes). This silently reduces data quality, but members don't know walls may be incomplete. `warnChainTruncated` boolean exists in the accumulate logic but isn't exported to payload.

**Files to change:**
1. `src/lib/public-gex-snapshot.ts` — add `chain_truncated: boolean` field to `GexHeatmap`
2. `src/lib/providers/polygon-options-gex.ts` — compute and wire `chain_truncated` through from accumulate phase
3. Member UI — show badge "⚠️ Data limited" or "⚠️ Full chain" under the strike axis when `chain_truncated` is true
4. `src/lib/route-registry.ts` — document field in `/api/market/gex-positioning` description

**Implementation:**

```typescript
// In polygon-options-gex.ts buildGexHeatmapUncached:
export async function buildGexHeatmapUncached(
  ticker: string,
  { expiries, ... }
) {
  let chainTruncated = false;
  
  for (const exp of expiries) {
    const contracts = await fetchPolygonOdteGexRows(ticker, exp);
    if (contracts.length === 0) {
      // Skip
      continue;
    }
    
    // Check if we had to use fallback
    if (contracts.length < 50 || contracts.length > 100) {
      chainTruncated = true; // Chain was capped or expanded
    }
    
    // ...accumulate normally
  }
  
  return {
    chain_truncated: chainTruncated,
    // ...rest of fields
  }
}

// In client UI (e.g., /heatmap Matrix tab):
{gexHeatmap.chain_truncated && (
  <div className="text-xs text-yellow-600 mt-1 flex items-center gap-1">
    <AlertIcon size={14} />
    Data limited: using full option chain
  </div>
)}
```

**Tests:**
- Unit: `polygon-options-gex.test.ts` — mock a thin chain (20 strikes) and verify `chain_truncated = true`
- Integration: `data-validator.mjs` — count tickers with `chain_truncated = true` across the market, report %
- Live: Tomorrow — verify badges appear on known low-vol/low-price names (e.g., sub-$5 stocks, pennies)

**Evidence:** Reduces information asymmetry. Existing walls/OI unchanged; flag just documents data quality. No breaking change.

**Risk:** Low. Additive field, UI-only display flag. No change to calculations.

**Related findings:** FINDINGS.md P2 "Truncated chain not visible" references this.
