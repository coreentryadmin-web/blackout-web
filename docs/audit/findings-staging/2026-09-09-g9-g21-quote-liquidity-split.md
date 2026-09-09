# G-9/G-21 clean separation: quote integrity vs contract liquidity/depth

> **kind:** FINDING

## Root cause

`evaluateQuoteValidity` (plan.ts, G-9) conflated two distinct failure modes under one
`QuoteInvalidReason` type: **quote INTEGRITY** (is the book real, sane, in-band, fresh —
zero_bid/crossed/locked/mark_out_of_band/wide_dollars/stale) and **liquidity/DEPTH** (is the
book thick enough to fill — thin_size). A book can be perfectly well-formed and still be too
thin, or vice versa (a crossed book with plenty of size is still not committable) — these are
independent axes, but the single reason type meant gates.ts could only ever surface ONE gate
code (`plan_quote_invalid`) for either failure, hiding which concern actually fired.

## Fix

Split into two SIBLING checks, neither a branch of the other:
- **G-9** (`evaluateQuoteValidity`) now owns ONLY zero_bid/crossed/locked/mark_out_of_band/
  wide_dollars/stale. `thin_size` was removed from its input (bidSize/askSize are no longer
  accepted parameters — a caller passing them is now a silent no-op elsewhere but the type
  signature itself no longer offers them, forcing the split to be visible at every call site).
- **G-21** (new `evaluateContractLiquidity` / `ContractLiquidityInvalidReason`) owns
  `thin_size` (moved verbatim) plus a genuinely new check, `no_volume_or_oi`: BOTH day
  volume and open interest reading zero/absent on the same snapshot — a listed-but-dead
  contract, distinct from a merely-thin-quoted one. Both predicates stay
  conditional-on-availability (absence of a field is never treated as proof of illiquidity),
  matching the discipline every other optional gate input in this file already follows.

`ContractPlan` now carries `liquidity_invalid_reason` (G-21) alongside the existing
`quote_invalid_reason` (G-9) — both optional, both independently nullable, so a plan can be
BOTH quote-invalid and thin at once and gates.ts surfaces BOTH distinct codes
(`plan_quote_invalid` and `plan_thin_size`/`plan_no_volume_or_oi`) rather than picking one.

## Blast radius

- `plan.ts`: `buildContractPlan` now accepts `openInterest`/`dayVolume` (in addition to the
  existing `bidSize`/`askSize`) and computes both reasons independently.
- `gates.ts`: new `contractLiquidityGateBlocks` (G-21, mirrors `planQualityGateBlocks`/G-8-9),
  `refreshContractLiquidityGateBlocks` (mirrors `refreshPlanQualityGateBlocks` for the
  thesis-first deferred-attach path), and `freshCommitBlockedByPlan` now checks BOTH axes.
  `QUOTE_INVALID_SENTENCE` dropped `thin_size`; a new `LIQUIDITY_INVALID_SENTENCE` covers
  both G-21 reasons. `evaluateZeroDteGates`'s plan-quality branch now pushes both
  `planQualityGateBlocks` and `contractLiquidityGateBlocks`.
- `board.ts`: two new `ZeroDteGateFailure` codes, `plan_thin_size` and `plan_no_volume_or_oi`.
- `scan.ts`: `attachContractPlans`'s `buildContractPlan` call now threads
  `snap.openInterest`/`snap.dayVolume` (real fields already on `OptionSnapshot` — no new
  provider fetch needed, this data was already flowing through the snapshot and simply
  wasn't reaching the plan). Both the thesis-first deferred-gate-refresh path and the
  last-mile pre-commit check (`freshCommitBlockedByPlan`) now also cover G-21.
- `pane.ts`: added `plan_thin_size`/`plan_no_volume_or_oi` display labels.
- Tests: `plan.test.ts`'s old `evaluateQuoteValidity: thin_size` test rewritten against the
  new `evaluateContractLiquidity`; `gates.test.ts` gained 7 new tests covering the new gate,
  the both-codes-at-once case, the deferred-refresh path, and `freshCommitBlockedByPlan`.

Note: G-9's live-commit-path timestamp hardening (a missing quote timestamp should
UNKNOWN/BLOCK rather than silently pass) is item 10 of this review's plan and is addressed
together with the live-commit-path precondition work (item 9), not here.

## Evidence

Full `src/lib/zerodte/*.test.ts` suite: 1312 pass / 0 fail on Node 20 (1 pre-existing unrelated
skip). Before the fix, `plan.test.ts`'s thin_size test failed (RED, `null !== 'thin_size'`,
since `evaluateQuoteValidity` no longer accepts size) until rewritten against
`evaluateContractLiquidity` (GREEN). `npx tsc --noEmit` clean.

| **Status** | FIXED in `fix/g9-g21-quote-liquidity-split` |
