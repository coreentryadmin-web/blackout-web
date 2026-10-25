## 2026-10-25 — [FINDING, P2 0DTE / Night Hawk] WS-11 `tranches[].fraction` audit trail rounds independently and sums to 0.99 instead of 1.00 — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD, `fix/zerodte-tranche-fraction-reconciliation`) |
| **Found by** | Adversarially-verified live audit, 12 production rows over a 90-day window |
| **Scope** | `src/lib/round-floats.ts`, `src/app/api/market/zerodte/record/route.ts`, `src/app/api/market/zerodte/board/route.ts` |

### Root cause

A WS-11 reconstructed TRIM-SCALE 0DTE play (`reconstructTrimScaleExecutableFromBars`,
`src/lib/zerodte/plan.ts`) that fires all 3 legs (two trims + the runner) produces a
`tranches: PlanTrancheFill[]` audit trail whose per-leg `fraction` is exactly
`TRIM_SCALE_RULES.tranche_fraction` (1/3, `src/lib/zerodte/exit-engine.ts`) for the first two
legs and the exact remainder for the runner. `plan.ts` tracks a `remaining` balance down to
precisely 0 across legs, so the UNROUNDED fractions always sum to 1 (within float epsilon)
regardless of how many legs fired.

This array is persisted verbatim into `entry_context.executable.tranches` at grading time
(`scan.ts`, `stampZeroDteExecutableGrade`) and later read back through `record.ts`'s `toPlay()`
(`entry_context: r.entry_context`, passed through unmodified) into `GET
/api/market/zerodte/record`'s response. The generic response-boundary helper `roundFloats()`
(`src/lib/round-floats.ts`, default `dp=2`) walks the whole payload and rounds every numeric leaf
INDEPENDENTLY — including each tranche's own `fraction` leaf. `0.3333333333333333` rounds to
`0.33` three times, and `0.33 + 0.33 + 0.33 = 0.99`, not `1.00`.

The OFFICIAL blended headline number (`managed_pnl_pct`, ultimately sourced from
`reconstructTrimScaleExecutableFromBars`'s own `round2(tranches.reduce((acc, t) => acc +
t.fraction * t.exit_pnl_pct, 0))`, `plan.ts` ~line 1009) is computed from the EXACT, unrounded
fractions BEFORE `roundFloats()` ever runs — so that number is correct and unaffected. The bug is
purely in what gets SERVED in the `tranches[]` array itself, which `plan.ts`'s own doc comment
describes as "the audit trail behind the one blended official number" — an invitation `record.ts`
and the Command Deck timeline both act on. A member (or any consumer) who recomputes the blend
from the DISPLAYED fractions gets a result ~0.5 percentage points below the real one. Confirmed on
12 distinct live production rows over a 90-day window — e.g. DELL 2026-10-14: recompute-from-
served-fractions gives 52.53%, served `managed_pnl_pct` is 53.06%.

### Blast radius

Two independent response-boundary sites serve the exact same persisted array and independently
re-round it:

1. **`GET /api/market/zerodte/record`** (`src/app/api/market/zerodte/record/route.ts`) —
   `record.plays[].entry_context.executable.tranches[].fraction`, the site the finding was
   reported against.
2. **`GET /api/market/zerodte/board`** (`src/app/api/market/zerodte/board/route.ts`) —
   `payload.ledger[].timeline_tranches[].fraction`. `timeline_tranches` is built by
   `readTimelineTranchesFromEntryContext` (`src/lib/zerodte/play-timeline.ts`), which reads the
   SAME `entry_context.executable.tranches` blob and reshapes it into `PlayTimelineTranche[]` for
   the Command Deck's play timeline — carrying the identical defect, independently discovered
   while tracing every consumer of the persisted array.

`round-floats.ts` already has an established fix pattern for this exact class of bug —
`reconcileStrikeTotal`/`reconcileCellStrikeTotals` — whose own doc comment states the general
problem ("rounding each field independently means Σ(round(x_i)) can drift from round(Σx_i))") and
fixes it by adjusting one value to absorb the rounding residual. Several OTHER fields literally
named `fraction` exist elsewhere in the codebase (Meridian peer-viz segments, swing scale-out
policy, 0DTE data-completeness groups) with unrelated semantics — this fix is deliberately scoped
to the two named call sites reading the WS-11 tranche array, not baked into the generic
`roundFloats()` walk, so none of those unrelated fields are touched.

### Fix

Added `reconcileTrancheFractions<T extends { fraction: number }>(tranches, dp = 2)` to
`round-floats.ts`, mirroring `reconcileStrikeTotal`'s approach one level deeper (sibling array
leaves instead of a leaf vs. a separately-rounded total): sums the ALREADY-ROUNDED fractions (as
integer "cents" to avoid re-introducing float noise), and if the sum doesn't equal 1.00 at `dp`,
adjusts the LAST tranche's `fraction` (the runner leg — "whatever is left over" by construction)
to absorb the residual. A split that already sums to 1.00 post-rounding (the 2-leg `0.33/0.67`
case, or any N-way split that happens to round evenly) is returned completely untouched — same
object reference, nothing rewritten. A malformed (non-finite) leaf also returns the array
untouched rather than guessing.

Called it explicitly, after `roundFloats()`, at both call sites:

- `record/route.ts`: loops `rounded.plays`, reconciling
  `entry_context.executable.tranches` in place when present.
- `board/route.ts`: loops `payload.ledger`, reconciling `timeline_tranches` in place.

### Fix rationale

Fixing at the response boundary (rather than at the source in
`reconstructTrimScaleExecutableFromBars`, which persists at grading time) is lower blast radius
for two reasons: (1) it protects BOTH known consumers of the persisted array with one shared
function, rather than requiring the grading-time write path to anticipate every future reader's
own independent rounding pass; (2) it never touches what's actually written to the DB (the
full-precision fractions stay exactly as computed, so the official `managed_pnl_pct` — which reads
those same unrounded fractions — can never be affected by a change made here). Explicit call sites
(not baked into the generic `roundFloats()` walk) were chosen over a shape-matching generic pass
specifically to avoid touching the unrelated `fraction`-named fields elsewhere in the codebase
(Meridian viz, swing exit policy, 0DTE data-completeness) that this bug does not describe and that
were out of scope for this fix.

Deliberately left unchanged: the 2-leg case (already self-consistent, explicitly tested to confirm
it stays byte-identical); the official `managed_pnl_pct`/`plan_pnl_pct` numbers (never touched by
`roundFloats()` or this fix — they're already `round2()`-ed from the unrounded fractions at the
source); the admin-only `/api/market/zerodte/board?sim=1` simulation branch (synthetic, non-member-
facing debug data, not part of this finding's scope).

### Evidence

RED→GREEN (`src/lib/round-floats.test.ts`): reverted `round-floats.ts` to its pre-fix state
(`git show HEAD:...`) and confirmed the 6 new `reconcileTrancheFractions` tests fail (the function
doesn't exist yet); restored the fix and confirmed all 6 pass, along with the full existing
27-test file (33/33 total). New tests cover: the exact DELL-style 3-leg `1/3+1/3+1/3` case
(rounds to `[0.33, 0.33, 0.34]`, summing to exactly 1.00 — only the runner leg moves); the 2-leg
`[0.33, 0.67]` case (returned as the same array reference, untouched); a single-tranche
immediate-stop array (`fraction: 1`, untouched); null/undefined/empty-array passthrough; a
malformed non-finite `fraction` leaf (untouched, never guessed); and a 4-way even split (`0.25`
each, already self-consistent, untouched).

Also ran `src/lib/zerodte/plan.test.ts`, `src/lib/zerodte/record.test.ts`,
`src/lib/zerodte/exit-engine.test.ts`, and `src/lib/zerodte/play-timeline.test.ts` (all green,
123+119 tests respectively across the two groups) to confirm no regression in the surrounding
grading/reconstruction/timeline logic this fix sits beside. `npx tsc --noEmit` clean.

Tests run on Node 20 (`/opt/node20/bin`) via
`npx tsx --experimental-test-module-mocks --test <file>`.
