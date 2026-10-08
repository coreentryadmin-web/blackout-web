# SPX PIN Regime Inversion Correctness Fix

> **kind:** FINDING

## Summary

The SPX PIN forecast engine inverted the regime classification logic, incorrectly mapping cumulative gamma signs to regime strings. The fix corrects the ternary operators in two locations to produce the right regime for each price level.

## Root Cause

The regime ternary operator was backwards:

```typescript
// WRONG (shipped):
input.spot >= flip ? "long_gamma" : "short_gamma"

// CORRECT (fixed):
input.spot >= flip ? "short_gamma" : "long_gamma"
```

**Why this matters:** 
- When cumulative gamma ≥ gamma-flip point, dealers are amplifying volatility (short from gamma perspective) → `short_gamma`
- When cumulative gamma < gamma-flip point, dealers are dampening volatility (long from gamma perspective) → `long_gamma`

The inverted ternary was claiming the opposite.

## Affected Code

| File | Lines | Change |
|------|-------|--------|
| `src/features/spx/lib/spx-pin-forecast-core.ts` | 391 | Primary regime computation in `pinComputeSyntheticForecast()` |
| `src/features/spx/lib/spx-pin-forecast-core.ts` | 757 | Montecarlo path-dependent regime recomputation in `synthesizePathDependent()` |

## Evidence

- **36 unit tests:** All passing, including regime expectation validations (Tests 3, 24, 25, 36 specifically verify regime correctness)
- **Logical proof:** Cumulative gamma sign and flip location directly determine regime; inversion was a pure logic error
- **Regression test:** Test suite includes RED→GREEN proof (committed)

## Validation Approach

Historical backtest was blocked by unavailable historical options data:
- Polygon provides historical SPX price bars ✅
- Polygon does NOT provide historical option chains for past dates ❌
- BlackOut does not persist historical PIN snapshots ❌

**Validated instead via:**
1. Unit test suite (36 tests, all passing)
2. Logical proof from first principles (regime definition matches fix)
3. Code review confirming single-point logic correction

This is a **correctness fix**, not a tuning hypothesis — the inverted ternary was objectively wrong by definition.

## Impact

- **Scope:** Regime classification only (wall selection, magnet selection, directional forecasts now use correct regime)
- **No changes to:** PIN thresholds, magnet logic, gate logic, scoring, or other control parameters
- **Side effects:** None (regime is purely logical downstream of gamma calculation)

## Status

| **Status** | **FIXED** |
|-----------|----------|
| **Validated** | Unit tests passing, logical review confirmed |
| **Deployed** | Pending PR merge |

## Historical Data Gap

Polygon's "Options Advanced" subscription (our tier) does not support `as_of` parameters for historical option chains, Greeks, or open interest. A full historical backtest would require either:
- Polygon subscription upgrade (sales cycle, cost TBD)
- PIN snapshot persistence implementation (new engineering project)

Neither is blocking this correctness fix, which is validated by logic and unit tests.
