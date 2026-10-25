> **kind:** FINDING

## Swing manage-sync: a Q37 roll-execution override wasn't reflected in the persisted snapshot — FIXED

**Lane:** Night Hawk Swings (Ask Largo × Night Hawk Swings standing mandate)
**Date found/fixed:** 2026-10-25

### Root cause

`src/lib/swing/manage-sync.ts`'s `syncSwingManagement` builds a management snapshot via `planManageSync`
(`plan.snapshot`), computed from the manager's PRE-arbitration verdict (`plan.verdict`). On the roll
branch, it then re-arbitrates that verdict at execution time via `executionVerdictForGating` (Q37 —
documented in `roll.ts`'s header as protecting against "a concurrent pass or slow chain fetch [that]
can leave a ROLL plan built while the structural stop has since broken"). When Q37's re-check
disagrees with the original verdict (e.g. flipping an intended ROLL into a forced CLOSE), the code
correctly used the NEW `executionVerdict` to decide and execute the terminal write (CLOSED vs ROLLED,
child-or-not) — but still handed the roll executor `plan.snapshot`, built from the STALE,
pre-arbitration verdict. The persisted append-only evidence snapshot (`event_json.rung`/`action`/
`reason`/`roll_intent`, `thesis_state`) would then document a verdict the system did not actually act
on — exactly the narrative-vs-reality mismatch already fixed once in `live-plays.ts` (the 2026-10-15
INTC repro, same root cause shape: two paths computing related facts from different-aged data).

### Blast radius

Single call site: `syncSwingManagement`'s roll-execution branch (the `buildRollPlan`/`hasRollLedger`
path). The mismatch would only ever manifest when `executionVerdictForGating` genuinely disagrees with
`plan.verdict` — demonstrated here via `ManageSyncReads.structuralStopLevel`, a type-supported
live-override seam no current production caller populates today (confirmed via repo-wide grep), so
this was a currently-dormant gap rather than an active member-facing defect — but a real one the moment
a caller starts supplying a live structural-stop level, or Q37 is extended to re-fetch fresher data
mid-tick per its own stated intent.

### Fix

Added `snapshotWithVerdict(snapshot, verdict)` (manage-sync.ts) — a small pure helper that overlays
`thesis_state`, `feature_vector.thesis_state`, and the verdict-sourced `event_json` keys from a given
verdict onto an existing snapshot, leaving every read-derived field (marks, DTE, excursion, quote)
untouched. `syncSwingManagement`'s roll branch now passes `snapshotWithVerdict(plan.snapshot,
executionVerdict)` instead of the raw `plan.snapshot`, so the persisted evidence always documents the
verdict actually acted on.

### Evidence

RED→GREEN: `src/lib/swing/active-refresh.test.ts` — new `runSwingActiveRefresh` end-to-end test
constructs a fixture where the primary verdict's structural check (using
`reads.structuralStopLevel ?? row.thesis_invalidation_px`, a loose 100) legitimately reaches
`expiry_risk`/ROLL, while Q37's re-check (using `row.thesis_invalidation_px` directly, a tighter 145)
independently finds a structural break and forces CLOSE. Asserts the ledger write is CLOSED (not
ROLLED, no child inserted) AND the persisted snapshot's `event_json.rung`/`thesis_state` read
`structural_stop`/`BROKEN` (what was acted on), not the stale `expiry_risk` the snapshot was first
built from. Failed pre-fix (`expiry_risk` persisted instead), passes post-fix. Full suite +
`tsc --noEmit` clean post-fix; existing `active-refresh.test.ts`/`manage-sync-q36.test.ts`/
`manage-sync-q37.test.ts`/`roll.test.ts`/`live-plays.test.ts` (98 tests) stay green.

| **Status** | FIXED |
