## Ask Largo × Night Hawk Swings — closed swing positions are graded ONLY by markfreeze P&L, the real multi-truth grader has zero production call sites — FIXED (additive read-only retrace)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/lib/swing/grade.ts` (`gradeSwingPosition`, the multi-truth grader) — no production wiring |
| **Status** | FIXED — additive read-only admin retrace endpoint shipped, not a member-facing change |
| **Severity** | P3 — audit/observability gap, not a data-correctness bug members are exposed to |
| **Found via** | Ask Largo × Night Hawk Swings standing ownership mandate (`CLAUDE.md`), re-surfaced on #4076 (comment 5751117208) while doing this cycle's CLOSED-plays audit (mission bullet: "retrace vs the 5-truth grader, `OUTCOME-GRADING-SPEC.md`") |

### Root cause

`docs/audit/OUTCOME-GRADING-SPEC.md` §6 (PR #5023, 2026-09-15) already documented this precisely but
it was only corrected in the doc, never raised as its own discussion item or acted on. Re-verified
against current `main` before building anything:

```
grep -rln "gradeSwingPosition" src/ --include="*.ts" | grep -v .test.ts
# swing-active-refresh/route.ts, db.ts, roll-plan.ts, roll.ts, grade.ts, horizon-outcomes.ts

grep -n "gradeSwingPosition" src/app/api/cron/swing-active-refresh/route.ts
# imported from "@/lib/db" -- the cheap markfreeze-write wrapper, NOT grade.ts's 5-truth grader

grep -rln 'from "./grade"\|from "@/lib/swing/grade"' src/ --include="*.ts" | grep -v .test.ts
# (empty)
```

`grade.ts`'s real `gradeSwingPosition` (EXECUTION/PATH/THESIS/MANAGEMENT/FINANCIAL — see that
file's own header) has zero non-test production call sites. Every closed swing position members see
is graded only by `gradeParentFromMark`'s (`roll-plan.ts`) single point-in-time markfreeze P&L
freeze, and that function's own `grade_json.note` field says outright: *"the EOD multi-truth grader
never re-litigates a frozen leg (graded_at IS NULL guard)"* — an EOD pass was designed for (the
`graded_at`/`legacy_grade` columns and the already-dead `fetchUngradedSwingPositions` accessor in
`db.ts` all anticipate it) but never built. A same closed position can therefore show a small
positive markfreeze P&L while its underlying THESIS actually broke (saved by a stop/roll) or a large
unrealized underlying MFE the exit never captured — none of that is visible anywhere today.

### Blast radius

Read-only, additive — no existing call site, column, or member-facing surface touched.
`gradeParentFromMark`/`decideRollAction` (the live markfreeze path) are unmodified.

### Fix

Smallest of three shapes floated on #4076 (comment 5751117208): a new admin-only, read-only export
route, `GET /api/admin/swing/multi-truth-grade` (`src/app/api/admin/swing/multi-truth-grade/route.ts`),
that fetches closed/rolled `swing_positions` rows (`fetchClosedSwingPositionsRange`, new `db.ts`
accessor — mirrors the existing `fetchSwingPositionsRange` pattern with a `status IN ('CLOSED',
'ROLLED')` filter), fetches real Polygon forward underlying daily bars per position's
`[committed_at, closed_at]` window (`fetchStockDailyBars`, the same production helper
`swing-active-refresh` already uses), and calls the REAL `grade.ts` `gradeSwingPosition` — returning
both the multi-truth grade and the row's own frozen markfreeze `grade_json`/`realized_pnl_pct` side
by side.

Scoped deliberately narrow this pass: only PATH + THESIS are populated (gradeable from underlying
bars alone, which production already fetches). EXECUTION stays honestly `ungradeable` (`no_fill` —
no real fill price is ever recorded on this ledger). FINANCIAL/MANAGEMENT stay honestly ungradeable
too (`optionBars: []` → `gradeBangerScaleOut`'s own `no_forward_bars` reason) — fetching historical
OPTION bars per position needs OCC resolution + Polygon options aggregates with no existing
production helper to reuse, a real follow-up rather than silently skipped or faked.

Row shaping is a pure, unit-tested mapper: `src/lib/swing/grade-retrace.ts`
(`swingRowToGradeInput`/`swingSubLaneFromRow`/`swingArchetypeFromRow`/`swingBarWindow`) — the route
itself only fetches and serializes. A companion read-only audit script,
`scripts/audit/swing-multi-truth-grade-retrace.mjs`, calls the new route and reports per-family
gradeable rates, THESIS outcome distribution, and flags rows where THESIS disagrees with the sign
of the markfreeze P&L members saw (a genuinely interesting divergence, not proof of a bug by
itself).

### Fix rationale

Deliberately NOT a new cron (this sandbox has no path to deploy a new EventBridge rule — see
CLAUDE.md's terraform/infra notes) and NOT a schema change to `grade_json` itself (that column's
markfreeze basis is frozen first-write-wins by design; overwriting it would be a much larger,
riskier change with no second opinion sought yet, exactly the caution the original #4076 comment
named for the medium/large shapes). An on-demand GET endpoint is additive, has zero blast radius,
needs no infra dependency, and immediately unblocks the CLOSED-plays audit gap this cycle's mission
bullet named — while leaving the medium ("surface a subset in the play-brief") and large ("make
markfreeze provisional") shapes exactly where #4076 left them, open for a second opinion.

### Tests

`src/lib/swing/grade-retrace.test.ts` (9 new tests): sub-lane/archetype validated-cast + degrade,
direction case mapping, EXECUTION honestly ungradeable (`no_fill`), FINANCIAL/MANAGEMENT honestly
ungradeable (`no_forward_bars`), a real underlying series producing a gradeable PATH (`mfePct` hand-
verified) + THESIS (`CONFIRMED`), and `swingBarWindow`'s widen/fallback/null-on-unusable behavior.
All 9 pass on Node 20 (`npx tsx --experimental-test-module-mocks --test
src/lib/swing/grade-retrace.test.ts`). Full `play-brief*`/`grade.test.ts` suites unaffected
(`grade.ts` itself untouched). `tsc --noEmit` clean.

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — once deployed, run
`node --import tsx scripts/audit/swing-multi-truth-grade-retrace.mjs --days=90` against production
and confirm the route returns real graded rows (not a 404/502), PATH/THESIS gradeable rates are
nonzero, and inspect any reported THESIS-vs-markfreeze divergences for genuine signal.
