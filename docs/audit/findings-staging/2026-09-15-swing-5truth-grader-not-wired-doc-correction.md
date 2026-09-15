> **kind:** FINDING

## OUTCOME-GRADING-SPEC.md described Swing's 5-truth grader as live production behavior; it has zero production call sites — DOC CORRECTED

| **Status** | FIXED (doc-only correction this commit) |
|---|---|

**What was wrong:** `docs/audit/OUTCOME-GRADING-SPEC.md` §6 and its §8 summary table state that the
live "Swing position record" is read via `gradeSwingPosition` (`src/lib/swing/grade.ts`), the
FIVE-truth (EXECUTION/PATH/THESIS/MANAGEMENT/FINANCIAL) grader. This is not what production does.

**Evidence (forensic batch 36, live 2026-09-15):**
- Repo-wide grep: `swing/grade.ts`'s `gradeSwingPosition` is imported ONLY by its own
  `grade.test.ts` — zero production call sites (no cron, no API route, nothing else).
- Live `GET /api/market/swing/record?days=90` (90-day window): **33/33 graded legs** carry
  `grade.methodology: "swing.roll.markfreeze.v1"` — never the 5-truth shape.
- Code trace: `closeAndRollSwingPosition` (`roll.ts`) is the only function that ever transitions a
  position to CLOSED/ROLLED. It freezes the parent leg via `gradeParentFromMark` (`roll-plan.ts`)
  — a single `(mark − entry) / entry × 100` calc — written through a DIFFERENT, same-named
  `gradeSwingPosition` (a DB write wrapper at `db.ts:7734`; do not confuse the two functions that
  share one name across `swing/grade.ts` and `db.ts`).
- `gradeParentFromMark`'s own `grade_json.note` field states the intended design explicitly:
  *"parent leg frozen at roll time from the live mark; the EOD multi-truth grader never
  re-litigates a frozen leg"* — the architecture always intended a separate EOD reconciliation
  pass using the real 5-truth grader to supersede this hot-path freeze. **That EOD pass does not
  exist** — nothing in `cron-registry.ts` or anywhere else in `src` calls `swing/grade.ts`'s
  grader outside its own test.

**What changed:** corrected §6 (added a dated correction block after the truth-family table) and
§8's summary table in `OUTCOME-GRADING-SPEC.md` to describe what's actually live (the markfreeze
grade) vs. what's pure/tested-only-and-unwired (the 5-truth grader). No application code touched —
this is a documentation-accuracy fix only.

**Not fixed:** whether the missing EOD reconciliation pass should be built (member-facing product
surface, live-trading-path scope, real design decisions on where the 5 truths would be exposed) is
raised as a design question on PR #4076 rather than built solo — see that thread for the escalation.

**Fix rationale:** a stale spec that claims dead code is live risks misleading a future
audit/engineer into treating THESIS/PATH/EXECUTION/MANAGEMENT as measured live signals when they
are not computed for any real position today — exactly the kind of "absence read as presence" trap
this repo's own audit discipline exists to prevent. Correcting the record is low-risk and
high-value; no RTH validation entry needed (nothing live changed).
