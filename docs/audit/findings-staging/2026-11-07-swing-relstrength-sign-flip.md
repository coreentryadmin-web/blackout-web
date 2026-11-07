# Sign-flip bug in liveManageEdgePillars() affects SHORT swing positions — FIXED

> **kind:** FINDING

## Root Cause

`liveManageEdgePillars()` in `src/lib/swing/manage-edge-reads.ts` computed unsigned returns (`pctReturnOverSessions()` delivers raw return %, no sign) and passed them directly to `relStrengthSignal()`. For SHORT positions, this inverted the meaning:
- SHORT thesis works when underlying DECLINES (negative return is good)
- But relStrengthSignal compares `(nameReturnPct - spyReturnPct)`
- Unsigned math: short stock down 37.5%, SPY flat → 37.5% - 0% = +37.5% rel strength (correct by accident only because both were unsigned)
- The bug: when rel_strength_lost checks `liveRs < WEAK_PILLAR`, it's comparing an INVERTED score for SHORT positions

## Solution

Apply direction-based signing BEFORE calling relStrengthSignal, matching the canonical signing from `swingSignalsFromReads()` (`src/lib/swing/swing-signals.ts:76-78`):

```typescript
const sign = args.direction === "short" ? -1 : 1;
const signedNameReturn = nameReturn != null && Number.isFinite(nameReturn) ? sign * nameReturn : nameReturn;
const signedSpyReturn = spyReturn != null && Number.isFinite(spyReturn) ? sign * spyReturn : spyReturn;
```

For SHORT: multiply returns by -1, so decline becomes positive (thesis working = positive relative strength).

## Live Impact

Positions incorrectly flagged as `rel_strength_lost`:
- PLTR SHORT (2026-11-06): underlying -21% vs SPY -8.93%, thesis working, falsely flagged
- GOOG SHORT (2026-11-06): underlying -12.16% vs SPY -10.95%, thesis working, falsely flagged

## Test Coverage Gap

Only LONG direction had test coverage (`liveManageEdgePillars: uptrend name vs flat SPY`). SHORT test was missing, allowing this bug to ship undetected.

**Added:** SHORT test case verifying downtrend performance generates strong rel_strength for SHORT positions.

## Files Modified

- `src/lib/swing/manage-edge-reads.ts`: Applied direction-based signing before relStrengthSignal call
- `src/lib/swing/manage-edge-reads.test.ts`: Added SHORT test case

| **Status** | FIXED — PR to follow |
