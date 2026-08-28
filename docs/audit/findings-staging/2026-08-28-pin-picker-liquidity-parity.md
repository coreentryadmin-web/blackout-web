> **kind:** FINDING

## PIN's contract picker never got the NH-R5 liquidity-quality tie-break BREAKOUT's picker got — FIXED

| **Status** | Fixed in PR (fix/pin-picker-liquidity-quality-parity) |
|---|---|

**Symptom:** Deep audit of contract/strike selection quality across all three discovery origins
(FLOW, BREAKOUT, PIN) as part of the continuous-improvement pass. No live symptom was reported for
this specifically — found by code comparison.

**Root cause:** NH-R5 (2026-08-03, `docs/audit/FINDINGS.md`) found that `breakout-source.ts`'s
`pickAtmZeroDteContract` ranked liquidity-admitted candidates purely on raw distance-to-spot: a
strike with a razor-thin 1-lot quote and a huge spread could out-rank an equally-close strike with
a tight two-sided market and real depth, because `sideHasLiquidity` is a binary admission gate
(any non-zero bid/ask/OI passes) with no further quality signal feeding the sort. The fix added
`liquidityQualityScore` (spread-tightness + OI-depth composite, capped 0-2) and re-sorted on
`effectiveDist = dist - quality * 0.15`, only breaking genuine near-ties.

`pin-source.ts`'s `pickAtmPinContract` — the PIN discovery origin's parallel picker, default-ON in
production (`ZERODTE_SRC_PIN`) — has an identical `sideHasLiquidity` predicate feeding a pure
`dist`-only sort. This is the exact same code shape BREAKOUT had before the fix; the NH-R5 fix was
never ported to its sibling. The original FINDINGS entry scoped the fix to `breakout-source.ts`
and explicitly noted the edition picker (`pickChainContract`) already had a real ladder — it did
not check PIN's picker, which shares the defect.

**Fix:** `pin-source.ts` now imports `liquidityQualityScore` and
`LIQUIDITY_TIE_BREAK_DOLLARS_PER_POINT` directly from `breakout-source.ts` (both exported for the
first time) rather than duplicating the logic — a single source of truth so the two pickers can't
drift apart again the way they did. `pickAtmPinContract`'s candidate sort now uses the same
`effectiveDist = dist - quality * LIQUIDITY_TIE_BREAK_DOLLARS_PER_POINT` NH-R5 uses.

**Blast radius:**
- `src/lib/zerodte/breakout-source.ts` — `LIQUIDITY_TIE_BREAK_DOLLARS_PER_POINT` exported (was
  module-private); no behavior change to BREAKOUT itself.
- `src/lib/zerodte/pin-source.ts` — `pickAtmPinContract`'s ranking logic, doc comment.
- `src/lib/zerodte/pin-source.test.ts` — 2 new tests mirroring `breakout-source.test.ts`'s NH-R5
  coverage: materially-better liquidity wins a close tie; ATM proximity still dominates over a
  distant higher-quality strike.

**Evidence of correctness:** `src/lib/zerodte/pin-source.test.ts` + `breakout-source.test.ts`:
30/30 pass. Full `src/lib/zerodte/*.test.ts` + `src/lib/zerodte/thesis/*.test.ts`: 1237/1237 pass
(1 pre-existing skip). `npx tsc --noEmit` clean. Node 20.
