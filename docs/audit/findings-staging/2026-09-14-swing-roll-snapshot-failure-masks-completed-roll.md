> **kind:** FINDING

## A snapshot-append failure after a successful swing roll/close was reported as `parentGraded:false`, silently dropping the member-facing terminal notification — fix/swing-roll-snapshot-failure-masks-completed-roll — 2026-09-14

| **Status** | FIXED |
|---|---|

### What was broken

Found during the standing Night Hawk Swings AGGRESSIVE MODE audit, reading `roll.ts` (PR-15, the swing roll executor — the one place the engine writes a terminal ROLLED/CLOSED status) fresh, never audited this session.

`closeAndRollSwingPosition` correctly documents and implements an all-or-nothing terminal write (child insert + parent grade, atomic via `runRollTx` when available). But the append-only management snapshot is written in a *separate* step AFTER that terminal write succeeds — by design, since it is evidence, not part of the all-or-nothing close (the file's own comment says so). The bug: that trailing `insertSnapshot` call was inside the SAME `try` block as the terminal write, with no isolation. If it threw, control fell into the function's single outer `catch`, which returns `{ ...base, error }` — and `base` was built with `parentGraded: false, childId: null` from *before* the terminal write ran. So a snapshot-insert failure (a transient DB blip, unrelated to the roll itself) caused the function to report the roll/close as **not completed**, even though the parent had already been terminally graded and, on a ROLL, the child had already been inserted.

Confirmed the bug directly (isolated repro, before touching any code): a fake ledger whose `gradeParent`/`insertChild` succeed but `insertSnapshot` throws returned `{ action: "ROLL", childId: null, parentGraded: false, error: "snapshot insert failed..." }` — despite `gradeParent` and `insertChild` having genuinely run and succeeded.

**Real consequence, not theoretical:** `swing-active-refresh/route.ts` (the cron that drives this) gates its member-facing terminal Discord notification on exactly this field:
```ts
for (const o of rolls) {
  if (!o.roll?.parentGraded) continue;   // <-- silently skips a roll that actually happened
  ...
  void notifySwingTerminalFromOutcome(parentRow, o.roll!, parentRow.last_mark)
}
```
So a roll/close that genuinely completed in the DB, hitting only this narrow trailing-snapshot failure window, would never notify the member the position rolled or closed — and the cron's own summary log line (`rolled=...`, `closed=...` counts, filtered on `parentGraded`) would silently undercount real activity.

### What changed

The snapshot insert now runs in its own inner `try/catch`, separate from the terminal-write block. A snapshot failure no longer overwrites the already-true `parentGraded`/already-set `childId` — it surfaces as `snapshotId: null` plus the snapshot's own error message, while `parentGraded`/`childId` correctly reflect what actually happened.

### Evidence

RED→GREEN (Node 20, `git stash` isolation): two new tests (ROLL and CLOSE variants) inject a ledger whose `insertSnapshot` throws after `gradeParent`/`insertChild` succeed, and assert `parentGraded: true` / the real `childId` / `snapshotId: null` / the snapshot's error message — both failed pre-fix (asserted `parentGraded:true`, got `false`) and passed post-fix. Full `roll.test.ts` 19/19 pass; combined with `roll-plan.test.ts` + `manage-sync-q36/q37.test.ts` (the nearest consumers), 42/42 pass. `tsc --noEmit` clean.

### Blast radius

`closeAndRollSwingPosition` has two callers: `roll-plan.ts` and `manage-sync.ts` (which is itself called from `swing-active-refresh/route.ts`, the live roll-execution cron). The fix only changes behavior in the narrow window where the terminal write succeeds but the immediately-following snapshot insert throws — every other path (terminal write itself failing, SKIP, atomic tx rollback on a grade race) is untouched, confirmed by the full existing suite passing unchanged.

### Fix rationale

Isolating the snapshot insert in its own try/catch (rather than, say, moving it before the terminal write, or making it part of the atomic transaction) preserves the file's own explicit design choice that the snapshot is evidence-only and deliberately outside the all-or-nothing close — the fix only corrects how a failure in that already-separate step gets *reported*, not when or how it runs.
