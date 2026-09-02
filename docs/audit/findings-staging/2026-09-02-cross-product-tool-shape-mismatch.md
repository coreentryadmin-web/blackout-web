# Cross-product ranking used incorrect tool response shapes

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED in `fix/cross-product-tool-shape-alignment` |
| **Severity** | P1 — would crash at runtime with shape mismatch |
| **Surface** | `src/lib/largo/cross-product-ranking.ts` scoreNightHawk function |

## Root cause

The `scoreNightHawk` function made incorrect assumptions about `get_nighthawk_edition` response shape:

**Wrong assumption:**
```typescript
const plays = await tools.get_nighthawk_edition?.();
const relevant = plays?.filter((p: any) => ...);  // plays is not an array!
```

**Actual shape** (from nighthawk-edition-for-model.ts):
```typescript
return {
  available: boolean,
  plays: [...],          // plays is nested inside the object
  play_count: number,
  // ... other fields
};
```

So `plays?.filter()` would crash because `plays` is an object with `plays` property, not an array.

## Fix

1. Corrected response unpacking: check `edition?.available` and `edition?.plays?.length`
2. Filter against `edition.plays`, not the top-level object
3. Added graceful fallback: if no specific ticker setup exists, use historical track record (confidence 0.6)
4. Better error handling: `try/catch` still catches malformed responses

## Evidence

- `npx tsc --noEmit` clean
- `npx tsx --test src/lib/largo/tool-defs.test.ts` 54/54 pass
- No tool changes, only consumer logic correction

## Blast radius

Only scoreNightHawk in cross-product-ranking.ts. The live-multiproduct-board was already correct (it checked `plays?.plays?.length`), so only this one scorer had the bug.

## Why it matters

This shape mismatch would have crashed any cross-product ranking query with Night Hawk, making the entire cross-product feature non-functional despite being "implemented". It's a silent runtime failure that wouldn't be caught until a user tried the feature in production.
