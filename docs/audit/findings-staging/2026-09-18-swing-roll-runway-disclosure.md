> **kind:** `FINDING`

## Ask Largo swing brief's roll-history narration never disclosed the runway a roll bought — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief-narrative.ts`) |
| **Severity** | P3 (a real, already-persisted field was unread by the one narration function that could use it — not a crash/incorrect-number bug) |
| **PR** | fix/swing-roll-runway-disclosure |

### Root cause

`SwingRollHistoryLeg.expiry` (`play-brief-types.ts:70`) is populated on every leg by
`swingRollHistoryLegFromRow` (`play-brief-roll-history.ts:16-30`, `expiry: r.contract_expiry`),
but `rollHistoryLine()` in `play-brief-narrative.ts` only ever read `strike`/`right` from the two
legs it cites (via `fmtLeg`) — `expiry` was never referenced anywhere in that function.

This matters specifically because `roll-plan.ts`'s own module header states the entire point of a
roll in its first paragraph: "A ROLL BUYS TIME" — and `buildRollChild` hard-gates every live roll
on `pick.dte > parentDte + buffer` (`DEFAULT_MIN_ROLL_BUFFER_DAYS = 2`) specifically to guarantee a
roll never goes flat or nearer. So the one property a roll is engineered to guarantee (more
runway) was the one property the roll-history narrative never disclosed — it said WHAT strike/
right the position moved to, never HOW MUCH extra time the move bought.

### Evidence

Grep evidence (pre-fix, on `origin/main`, which already includes #5190):
- `play-brief-types.ts:70`: `expiry: string | null;` on `SwingRollHistoryLeg`.
- `play-brief-roll-history.ts:27`: `expiry: r.contract_expiry,` — populated on every leg.
- `roll-plan.ts`'s own module header: "A ROLL BUYS TIME" design intent, plus
  `DEFAULT_MIN_ROLL_BUFFER_DAYS` gating every live roll on strictly more DTE.
- Every rolled-chain fixture in `play-brief-narrative.test.ts` (pre-fix) already carried two
  distinct, real expiry dates per leg (e.g. `2026-08-15` → `2026-09-19`), confirming the field is
  real, populated, and simply unread — verified before touching any test.
- Zero pre-existing hits for `rollRunwayExtensionDays` or any expiry-delta logic in
  `rollHistoryLine`, verified by isolating `play-brief-narrative.ts` via `git stash` before the
  fix.

RED→GREEN proof (independently reproduced on a fresh `fix/swing-roll-runway-disclosure` branch off
the actual latest `origin/main`, which already includes #5190's merge):
- Reverted `play-brief-narrative.ts`, kept the tests. `npx tsx --experimental-test-module-mocks
  --test src/lib/swing/play-brief-narrative.test.ts`: **7 failures** (missing export +
  6 assertions expecting the new runway clause) — the expected "field/branch doesn't exist yet"
  shape. 86/93 pass, nothing pre-existing broke.
- Reapplied. Re-ran the same file: **93/93 pass**. Broader sweep (`play-brief-narrative.test.ts` +
  `play-brief-roll-history.test.ts` + `roll-plan.test.ts` + `play-brief.test.ts`): **197/197
  pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20): result to be appended once the background run completes.

### Blast radius

Single-file addition to one narration function:
- `src/lib/swing/play-brief-narrative.ts` — new exported pure helper
  `rollRunwayExtensionDays(prevExpiry, currExpiry)`; wired into `rollHistoryLine()`'s existing roll
  sentence as an appended clause.

No new fields threaded through the data model — `expiry` was already present on
`SwingRollHistoryLeg`; this fix only adds a small derived computation at one existing call site.
Deliberately did NOT surface the roll-EXECUTION path's delta/cost-of-roll data (`contract_delta`,
`entry_premium`, `entry_underlying_px` on each leg row) — `play-brief-types.ts:63-65`'s own doc
comment states the roll-history type is deliberately minimal ("no P&L; the narrative discloses
WHAT was rolled, not how it graded"), so surfacing P&L/cost-of-roll there would violate that
explicit, deliberate design choice. The runway/DTE angle is orthogonal to P&L and does not conflict
with it.

### Fix rationale

Additive per the Largo product contract: a new pure helper, one new clause appended to an existing
sentence, nothing removed or flattened. Null-honest on both the obvious failure mode (missing/
unparseable expiry) and a defensive floor on a non-positive delta — the roll-gate above means a
flat/backwards roll should never reach this function live, but the floor costs nothing and
protects against ever printing a fabricated or backwards "extra days" claim on a malformed
historical leg.

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main` (which already includes #5190's merge), not the originating research round's own
  working-tree state — diff applied cleanly, RED/GREEN reproduced independently, tsc clean.
- Full suite result to be appended once the background run completes.
