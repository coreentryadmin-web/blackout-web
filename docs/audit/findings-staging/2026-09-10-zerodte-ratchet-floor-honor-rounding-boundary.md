# 0DTE ratchet floor "cannot finish red" guarantee silently breaks at a cent-rounding boundary — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-zerodte-ratchet-floor-honor-rounding-boundary |
| **Priority** | P2 |
| **Area** | 0DTE exit engine — `resolveExitMark`/`buildExitContext` (`src/lib/zerodte/exit-engine.ts`) |
| **Status** | FIXED |

## Symptom

Live forensic audit (2026-09-10, Night Hawk 0DTE lane), real committed play: QQQ short,
entry_premium 0.22, peaked at +47.73%. The profit ratchet correctly armed its breakeven floor at
that peak (`ratchetFloorPct`: peak ≥ 20% → floor 0%). The engine's own `exit_detail` read:
`"Mark 0.215 (-2.27%) is at/below the 0% floor armed by a +47.73% peak — the protective floor
exits so the green trade cannot finish red."` — yet the ledger row persisted `exit_pnl_pct: -2.27`
and `exit_mark_honored: false`. A trade whose own exit narrative promises "cannot finish red"
finished red, on a real live commit, not a synthetic scenario.

## Root cause

`resolveExitMark` (the floor-vs-observed-print selector) correctly used `Math.max(observedMark,
protectiveFloorMark(...))` on the RAW (unrounded) values — for QQQ, `Math.max(0.215, 0.22) =
0.22`, i.e. the floor legitimately won and `mark` resolved to the floor (breakeven).

But `buildExitContext` derived the `mark_honored` flag by comparing the two ALREADY-ROUNDED
values — `mark !== markObserved`, where `markObserved = round2(observedMark)`. Because the raw
observed print (0.215) cent-rounds UP to exactly 0.22 — the SAME rounded value as the floor mark
(also 0.22) — the two rounded numbers came out equal, and `markHonored` read `false` even though
the floor mechanism (via `Math.max`, on the raw values) is what actually determined the fill.

`buildExitContext`'s `pnl_pct` field then branches on that flag: `pinnedLivePnlPct(entryPremium,
markHonored ? mark : observedMark)`. With `markHonored` wrongly `false`, `pnl_pct` was computed
from the RAW `observedMark` (0.215) instead of the floor-honored `mark` (0.22) — producing
`(0.215-0.22)/0.22*100 = -2.27%` instead of the correct `0%`.

This is the same class of rounding-vs-raw-precision bug the 2026-09-04 CRCL fix (same file, see
the `pnl_pct` comment block) already addressed for the OPPOSITE direction (a non-honored exit's
pnl_pct wrongly computed from a rounded mark, erasing real signal) — that fix correctly kept
`pnl_pct` on raw precision for non-honored exits, but left the `markHonored` DETECTION itself
comparing two rounded values, which is a distinct bug: the detection, not the pnl formula, is what
misfires at this particular boundary (raw print within half a cent below the floor, such that both
round to the same cent).

## Evidence

RED→GREEN, `src/lib/zerodte/exit-engine.test.ts`:
- Added `"buildExitContext: a floor mark that rounds to the same cent as the raw observed print is
  still honored"` — ENTRY 4.0, peak 4.8 (+20%, arms breakeven), observed 3.995 (raw, below the
  4.00 floor, but `round2(3.995) === 4.00`, matching the floor's own rounded value).
- Updated `"resolveExitMark: ratchet floor caps at floor premium; thesis uses observed"` for the
  new `{ mark, honored }` return shape.
- **Pre-fix** (production code reverted to `origin/main`, test file kept): `npx tsx
  --experimental-test-module-mocks --test src/lib/zerodte/exit-engine.test.ts` — 81 pass / **2
  fail** (`mark_honored` read `false` expected `true`; the `resolveExitMark`-shape test failed on
  `undefined !== 4`, since the old function returned a bare number with no `.mark`).
- **Post-fix**: same file — **83 pass / 0 fail**.
- `npx tsc --noEmit` — clean (the one production call site of `resolveExitMark`,
  `buildExitContext`, was updated for the new return shape; no other call sites exist outside this
  file and its own test).
- Full `npm test` (Node 20) — pending in background at write time; will confirm before merge.

## Blast radius

`resolveExitMark` has exactly one production call site (`buildExitContext`, same file) — grepped
repo-wide. No other consumer reads its return value directly. The bug only manifests for
`ratchet`/`runner_floor`-reason exits (the SHIPPED default profit-management family,
`DEFAULT_EXIT_MODE` config permitting) where the raw observed print sits strictly below the floor
by less than half a cent — a narrow but real boundary that a live, real-money commit hit on
2026-09-10. `trim_scale` mode's own tranche/target exits are a separate code path
(`decideTrimScale`) and were not touched or affected.

## Fix rationale

Changed `resolveExitMark`'s return type from a bare `number` to `{ mark: number; honored: boolean
}`, computing `honored` from the SAME raw (pre-rounding) comparison the `Math.max` selection
itself uses (`floorMark > observedMark`) — a single source of truth, so the flag can never
disagree with which value actually determined the fill. `buildExitContext` now destructures that
result directly instead of re-deriving "was it honored" by comparing two independently-rounded
numbers.

Considered re-deriving the floor-applicability condition inline in `buildExitContext` instead
(cheaper diff, no signature change) — rejected: the existing code comment at that exact call site
already warns against this ("re-deriving the floor condition... this flag cannot drift from what
resolveExitMark actually did"), for good reason — duplicating the `reason.startsWith("ratchet")` /
`floor != null` condition in two places is exactly how this class of divergence bug gets
reintroduced later. Returning the decision from the single function that makes it keeps that
invariant structural rather than convention-enforced.

Did not touch the CRCL 2026-09-04 fix's own logic (raw-precision pnl for non-honored exits) — that
fix is correct for what it addresses; this fix corrects the INPUT to that branch (whether a given
exit truly counts as non-honored), not the branch's own arithmetic.
