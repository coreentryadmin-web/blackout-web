> **kind:** FINDING

## 0DTE ledger: `computeLedgerGrade()` decided `direction_hit` off the UNROUNDED move, so a sub-±0.005% move served `move_pct: 0` alongside `direction_hit: true/false` — FIXED

**Status:** Fixed, regression test added (`src/lib/zerodte/board.test.ts`).

### Root cause

`computeLedgerGrade()` (`src/lib/zerodte/board.ts`) computes a single signed % move
(`signed`), then returns two fields derived from it: the DISPLAYED `move_pct` (rounded to 2
decimals) and `direction_hit` (a three-way true/false/null). Before this fix, `direction_hit`
was decided from the RAW, unrounded `signed`, while `move_pct` was the ROUNDED value — two
different numbers deciding two fields that are supposed to agree:

```ts
move_pct: Math.round(signed * 100) / 100,
direction_hit: signed > 0 ? true : signed < 0 ? false : null,
```

The function's own code comment defines a served `move_pct: 0` as "breakeven — no
directional edge, should be null" (added 2026-07-xx, "Fix 4" in the dated
`docs/audit/FINDINGS.md` entry for the zerodte-grading-record-honesty cluster — that fix
only handled the EXACT-zero case, `signed === 0`). It never handled the ROUNDING-BOUNDARY
case: any `signed` in `(-0.005, 0.005)` rounds to a displayed `move_pct: 0` but is not
exactly zero, so the old `signed > 0 ? true : signed < 0 ? false : null` line still resolved
a non-null `direction_hit` for it — a served row simultaneously claiming "breakeven" (the
displayed 0) and "directional hit/miss" (true/false), which can never both be true by the
function's own stated definition.

### Evidence

- **Live, 2026-10-31**, `GET /api/market/zerodte/record?days=90` (authenticated via
  `mintClerkPremiumSession`, 589 graded plays): the SPXW 2026-08-12 row served
  `"move_pct": 0, "direction_hit": true`. Scanning all 589 rows for the invariant
  `move_pct>0 <=> direction_hit:true`, `move_pct<0 <=> direction_hit:false`,
  `move_pct==0 <=> direction_hit:null` found exactly **this one violation** (0/589
  elsewhere) — reproduced independently with a scratch script against the live route
  (`total rows: 589 violations: 1`).
- Confirmed by reading `board.ts`'s pre-fix `computeLedgerGrade` directly: `signed=0.001`
  (inside the rounding band) gives `Math.round(0.1)/100 = 0` for `move_pct` but
  `0.001 > 0` is `true` for the old `direction_hit` line — the exact live shape above.
- Checked `docs/audit/FINDINGS.md` / `docs/audit/findings-staging/*.md` and PR #7081 (open at
  the time this was reported) — neither mentions this rounding-order gap; #7081 is an
  unrelated admin UW live-integration-prefix fix, no overlap.
- **RED (pre-fix, via `git stash` on `board.ts` only, new test kept):** the new test failed —
  `tinyFavorableLong.direction_hit` resolved `true` where `null` was expected, with the
  assertion message `"a row displaying move_pct:0 must never also claim a directional hit"`.
- **GREEN (fix restored):** `src/lib/zerodte/board.test.ts` — 149/149 pass.
- Broader re-run: `src/lib/zerodte/*.test.ts src/lib/*record*.test.ts
  src/lib/correctness/*.test.ts` — 1855/1856 pass (1 pre-existing, unrelated skip).
- `npx tsc --noEmit` clean; `npx eslint` clean on both touched files.

### Blast radius

`computeLedgerGrade` has exactly one production call site (`scan.ts`'s
`gradeZeroDteLedger`, which persists its result via `gradeZeroDteSetupRow` into
`zerodte_setup_log.direction_hit`/`move_pct`). Every downstream reader of that column —
`fetchZeroDteGradeForAudit` / `mapZeroDteOutcome` (`src/lib/bie/alert-outcome-sync.ts`,
feeds the precedent-search terminal-outcome vocabulary) and the `/api/market/zerodte/record`
route's underlying-move honesty ledger — inherits the corrected value automatically; no
other file re-derives `direction_hit` from a raw move independently (grepped repo-wide), so
there is no second site carrying the same bug. Materiality is low by design of the bug
itself (only triggers inside a ~±0.005% band): 1 of 589 rows in the measured 90-day window,
with zero effect on the separately-computed wins/losses/breakeven counts (those key off
`managed_pnl_pct`, not `direction_hit`).

### Fix rationale

Round `signed` into `move_pct` FIRST, then derive `direction_hit` from that same rounded
`move_pct` instead of the raw `signed`:

```ts
const move_pct = Math.round(signed * 100) / 100;
return {
  close_price: closePrice,
  move_pct,
  direction_hit: move_pct > 0 ? true : move_pct < 0 ? false : null,
};
```

This makes the inconsistency impossible by construction: whatever value is actually served
as `move_pct` is the exact value `direction_hit` is decided from, so a displayed `0` can
never coexist with a `true`/`false`. Considered and rejected: tightening the exact-zero
check to a tolerance band (e.g. `Math.abs(signed) < 0.005`) instead of rounding first — that
duplicates the rounding threshold as a second hard-coded constant that could drift out of
sync with `Math.round(x*100)/100`'s own boundary (e.g. if the display precision ever changes
from 2 decimals), where deriving both fields from the one already-rounded number can't drift
by construction.

### Deliberately left unchanged

- The ungradeable branch (missing flag price or close) — untouched, still returns
  `{ move_pct: null, direction_hit: null }`.
- The exact-zero/dead-flat case from the earlier "Fix 4" — unchanged behavior, now simply
  one instance of the more general rounded-to-zero case rather than a special-cased check.
- `move_pct`'s own rounding precision (2 decimals) and the `Math.round` tie-breaking
  convention — not what this bug is about; only the ORDER in which rounding and the
  direction decision happen changed.
