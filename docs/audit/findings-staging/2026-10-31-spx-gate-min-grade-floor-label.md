## 2026-10-31 — [FINDING, P3 SPX Slayer UX] grade-below-minimum gate block hardcodes "need B or better" regardless of the configured floor — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|------------|-------|

### Symptom

`src/features/spx/lib/spx-play-gates.ts`'s `evaluatePlayGates`, when a play's grade falls below
the configured quality floor, pushes:

```
Grade ${confluence.grade} below minimum (need B or better)
```

The gate **condition** that triggers this block (`gradeRank(confluence.grade) < playMinGradeRank()`)
correctly reads the REAL configured floor from `playMinGradeRank()` (`spx-play-config.ts`, driven
by `SPX_PLAY_MIN_GRADE`, defaulting to `"B"` only when the env var is unset). The **message**,
however, hardcodes the literal word `"B"` no matter what the floor actually is. If an operator (or
a future adaptive-gate change) ever sets `SPX_PLAY_MIN_GRADE` to `"A"` (tightening quality) or to
`"C"`/`"D"` (loosening it), the condition fires correctly against the new floor, but the displayed
reason keeps claiming the floor is `"B"` — a factually wrong reason for the block that actually
fired. Masked in production today only because `SPX_PLAY_MIN_GRADE` is currently unset, so the
default-B fallback happens to make the hardcoded text correct by coincidence.

### Root cause

`spx-play-gates.ts` (pre-fix):

```ts
if (gradeRank(confluence.grade) < playMinGradeRank()) {
  const gradeMsg = `Grade ${confluence.grade} below minimum (need B or better)`;
  ...
}
```

`playMinGradeRank()` (`spx-play-config.ts`) resolves `SPX_PLAY_MIN_GRADE` to a numeric rank
(`D`=0 … `A+`=4, default `B`=2 when unset) — the condition above is already dynamic. The message
was never updated to track that same floor; it names the DEFAULT value of the floor, not the
ACTUAL one. This is the same bug class as the cold-BUY grade block a few lines below (fixed
2026-10-21, `docs/audit/FINDINGS.md`'s "cold-BUY gate block message hardcodes 'B setups'" entry) —
that fix made the cold-BUY message interpolate `confluence.grade` dynamically, but never touched
this earlier, more general "Grade X below minimum" block, which still hardcoded the FLOOR'S NAME
rather than deriving it from `playMinGradeRank()`.

No existing test caught this: `spx-play-gates.test.ts` only asserted the block text matches
`/below minimum/i`, never that the floor-name clause tracks `SPX_PLAY_MIN_GRADE`.

### Evidence

Reproduced locally and proved RED → GREEN with `git stash` isolating only the two source files
(`spx-play-gates.ts`, `spx-play-config.ts`) — the test file, which already carried the new
regression test, was never touched by the stash:

- **RED** (pre-fix source, new test's fixture: `SPX_PLAY_MIN_GRADE=A`, play `grade: "B"`):
  `gates.blocks` joined to `"Grade B below minimum (need B or better)"` — assertion
  `/Grade B below minimum \(need A or better\)/` failed with `AssertionError` (actual message
  still claimed the floor was B even though the real configured floor was A, and the condition
  had already blocked the B-grade play against that A floor).
- **GREEN** (fix restored): same fixture now produces
  `"Grade B below minimum (need A or better)"` — full suite
  `src/features/spx/lib/spx-play-gates.test.ts` 30/30 pass (Node 20,
  `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-play-gates.test.ts`).
- Sibling suites that touch the same gate/config surface also pass clean after the fix:
  `spx-play-gates-playbook-allowlist.test.ts`, `spx-play-intel.test.ts`, `spx-play-payload.test.ts`,
  `playbook-gate-categories.test.ts`, `playbook-shadow-log.test.ts` — 58/58 combined.
- `npx tsc --noEmit` clean on the whole project after the fix.

### Fix

Added `playMinGradeLabel()` to `spx-play-config.ts` — the human-readable label (`"D"`…`"A+"`) for
the same rank `playMinGradeRank()` resolves, including the identical unrecognized-env-value
fallback to `"B"` — and interpolated it into the gate message instead of the literal `"B"`:

```ts
const gradeMsg = `Grade ${confluence.grade} below minimum (need ${playMinGradeLabel()} or better)`;
```

Because `playMinGradeLabel()` derives its answer from `playMinGradeRank()` (the exact same rank the
gate condition uses), the displayed floor and the floor that actually fired can never disagree
again, regardless of what `SPX_PLAY_MIN_GRADE` is set to.

#### Deliberately left unchanged

- The gate condition itself (`gradeRank(confluence.grade) < playMinGradeRank()`) was already
  correct; only the message text was wrong.
- The cold-BUY grade block a few lines below (already fixed 2026-10-21 to interpolate
  `confluence.grade`) needed no change — it names the PLAY's grade, not the FLOOR's, and was never
  part of this bug.
- `spx-play-gates-playbook-allowlist.test.ts`'s full-module mock of `spx-play-config` was extended
  with `playMinGradeLabel: () => "B"` to keep it realistic alongside its existing
  `playMinGradeRank: () => 2`, though no test in that file exercises a grade below the mocked
  floor, so this was precautionary rather than required to make it pass.

### Blast radius

Single call site — `spx-play-gates.ts`'s one "Grade X below minimum" block is the only place this
literal string is produced. Downstream consumers (`spx-play-intel.ts`'s `humanizeGateBlock`,
`spx-play-payload.ts`) match on the substring `"below minimum"` only, never on the full
`"need B or better"` clause, so they are unaffected by the message now naming a different letter.
