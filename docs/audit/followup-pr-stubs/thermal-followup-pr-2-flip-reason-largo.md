# PR: Add Flip Reason to Largo GEX Tools

**Issue:** `flip_reason` explains unavailable flip (insufficient data, net short everywhere) but isn't published to Largo tools `get_gex_heatmap` / `get_positioning`.

**Root cause:** Server computes `flip_reason` in `buildGexRegime()` as metadata for why flip is null/unavailable, but doesn't include it in the Largo contract. Member tools that describe dealer positioning can't explain to Largo why the flip level is missing.

**Files to change:**
1. `src/lib/largo/contract/product-read.ts` — add `flip_reason` field to positioning contract
2. `src/lib/providers/polygon-options-gex.ts` — wire `flip_reason` into the heatmap payload (already computed, just needs export)
3. `src/lib/large/query/get-gex-heatmap.ts` or similar — include flip_reason in Largo tool response
4. Documentation: `docs/thermal/LARGO-INTEGRATION.md` — document when `flip` is null and `flip_reason` populated

**Implementation:**

```typescript
// In src/lib/largo/contract/product-read.ts:

export type GexPositioning = {
  spot: number;
  flip: number | null; // existing
  flip_reason?: 'insufficient_data' | 'net_short_everywhere' | 'net_long_everywhere'; // NEW
  regime: 'long' | 'short';
  walls: {
    call: number | null;
    put: number | null;
  };
  // ...rest of fields
}

// In polygon-options-gex.ts buildGexRegime:
export function buildGexRegime({
  spot,
  flip,
  callWall,
  putWall,
  flipReason, // NEW: already computed here
}: ...): {
  posture: 'long' | 'short';
  read: string;
  flip: number | null;
  flip_reason?: string; // NEW: wire out
  callWall: number | null;
  putWall: number | null;
} {
  return {
    posture: flip !== null ? (flip > spot ? 'long' : 'short') : (putWall > callWall ? 'long' : 'short'),
    read: '',
    flip,
    flip_reason: flip === null ? flipReason : undefined, // Only include when flip is null
    callWall,
    putWall,
  };
}

// In any Largo tool that returns positioning:
const positioning = await buildGexHeatmapUncached(...);
return {
  spot: positioning.spot,
  flip: positioning.gex.flip,
  flip_reason: positioning.gex.flip_reason, // NEW
  regime: positioning.gex.regime,
  // ...etc
};
```

**Tests:**
- Unit: `largo-contract.test.ts` — verify `flip_reason` is populated when `flip` is null
- Integration: `data-validator.mjs` — run against tickers with known flip unavailability (low-volume, earnings-gap names), verify `flip_reason` is documented
- Live: Tomorrow — measure % of queries where flip is null and flip_reason is populated; report distribution

**Evidence:** `flip_reason` already exists in `buildGexRegime` compute path; this is export/documentation only. No new computation.

**Risk:** Very low. Additive field, doesn't change existing behavior. Largo model may need update if it doesn't expect the field, but contract is the source of truth.
