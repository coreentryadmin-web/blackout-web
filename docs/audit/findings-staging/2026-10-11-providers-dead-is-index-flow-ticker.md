## Providers `isIndexFlowTicker` — dead export — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/providers-dead-exports-2) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `isIndexFlowTicker` (`src/lib/providers/flow-price-symbol.ts`) returned
`flowPriceSymbol(ticker)?.isIndex === true` — a thin convenience wrapper over the real function,
`flowPriceSymbol`, which already returns an `isIndex` field directly. No caller used the wrapper;
every real caller of this module reads `.isIndex` off `flowPriceSymbol`'s own return value.

**Evidence:** `grep -rn "isIndexFlowTicker" --include=*.ts --include=*.tsx src scripts` → only the
definition and one direct assertion in its own test, before the fix.

**Fix:** Removed `isIndexFlowTicker`. Removed its import and the one direct assertion from
`flow-price-symbol.test.ts` — the same behavior is already asserted immediately above it via
`flowPriceSymbol("ZZZZ")`'s own `isIndex: false` field.

**Fix rationale:** Pure deletion — no live caller to redirect, and the removed assertion was
redundant with an existing one in the same test.

**Blast radius:** `src/lib/providers/flow-price-symbol.ts`,
`src/lib/providers/flow-price-symbol.test.ts` only.

**Regression guard:** `flow-price-symbol.test.ts` 9/9 pass (Node 20,
`--experimental-test-module-mocks`). `tsc --noEmit` clean.
