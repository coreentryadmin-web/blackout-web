## 2026-09-04 — [FINDING, P2 correctness] Night Hawk readiness chip falsely green on clock-skewed future `as_of` — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 correctness |
| **Surface** | `src/lib/zerodte/pane.ts` (`resolveZeroDteReadiness`) |
| **Status** | FIXED |

### Root cause

`resolveZeroDteReadiness` only flagged DELAYED when `asOfAgeMs > staleAfterMs`. A future-dated board `as_of` (client/server clock skew) produced a negative `asOfAgeMs` that never exceeded the threshold, so the chip stayed green **READY** even though freshness could not be verified. Sibling `resolveZeroDteFreshness` in `ZeroDteBoard.tsx` already guarded this class of skew via `ZERODTE_MARK_FUTURE_TOLERANCE_MS`; the readiness helper was missed.

### Fix

Treat `asOfAgeMs < -ZERODTE_MARK_FUTURE_TOLERANCE_MS` the same as stale age — amber **DELAYED** with the existing copy.

### Regression guard

`src/lib/zerodte/pane.test.ts` — future-skew case beyond tolerance reads DELAYED.

### Market-open validation

On `/nighthawk` during RTH, confirm the readiness chip shows **DELAYED** (not **READY**) if board `as_of` is materially in the future relative to the client clock (simulate via devtools clock skew or inspect after a known skew incident).
