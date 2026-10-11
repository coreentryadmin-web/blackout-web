> **kind:** FINDING

## Thermal — 3 dead `thermal-desk-state.ts` helpers + 1 exclusively-orphaned constant — FIXED

**Symptom:** `thermal-desk-state.ts` exported three functions with zero callers anywhere in
`src/` outside their own definitions and their own direct unit tests:
- `shouldForceBlankMatrixRefresh(ticker, opts)` — decides whether a blank sector-compare
  matrix column for a core ticker (SPY/SPX/QQQ/IWM) should auto-escalate to a forced
  (`?force=1`) Polygon refresh.
- `wallScopeLabel(nearTermExpiries)` — builds the "Walls · N near-term" chip short/title
  copy.
- `honestLevelEmpty(kind)` — returns `{value:"—", help}` placeholder copy for a missing
  flip/cross_val/shift key level.

No component (`GexHeatmap.tsx` or any other Thermal component) imports any of the three —
confirmed via `grep -rn` repo-wide and by checking internal call sites within the same
file (none call each other either). Each had genuinely orphaned test coverage — the
tests exercised the function's own logic directly, never a real consumer.

**Root cause:** These read like leftover helpers from a refactor — components likely kept
an inline copy of this logic or never wired these up — not deliberate ahead-of-adoption
scaffolding. (One sibling export in the same directory, `thermalIntensityBlockCount` in
`thermal-intensity.ts`, WAS checked and found to be self-declared scaffolding via its own
doc comment — "for tests / optional text fallback" — and was correctly left alone, not
part of this fix.)

**Evidence:** `grep -rn "shouldForceBlankMatrixRefresh\|wallScopeLabel\|honestLevelEmpty\|THERMAL_MATRIX_CORE_TICKERS"
src/` before the fix: only `thermal-desk-state.ts`'s own definitions and
`thermal-desk-state.test.ts`'s own direct tests.

**Fix:** Removed all three functions. Also removed `THERMAL_MATRIX_CORE_TICKERS`
(`["SPY","SPX","QQQ","IWM"]`), exclusively used by `shouldForceBlankMatrixRefresh` with no
other caller anywhere (cascading removal, same discipline as this session's other
exclusively-orphaned-dependency cleanups). Removed the corresponding imports and test
blocks; one assertion (`honestLevelEmpty("cross_val").help` not leaking the vendor name
"UW") lived inside a different, still-valid test about `thermalLayerFreshness`'s
cross-check label — removed only that one assertion, kept the rest of that test intact.

**Fix rationale:** Pure deletion — no live behavior depended on any of the four removed
exports, and no gap is left for a caller to miss.

**Blast radius:** `src/features/thermal/lib/thermal-desk-state.ts` and
`thermal-desk-state.test.ts` only.

**Regression guard:** None needed — no removed export had production behavior to guard;
the removed test assertions had no value beyond re-confirming the deleted functions' own
bodies (or, for the one surviving-test assertion removed, a sub-point the test's remaining
assertions already cover in spirit for the function that IS live).
