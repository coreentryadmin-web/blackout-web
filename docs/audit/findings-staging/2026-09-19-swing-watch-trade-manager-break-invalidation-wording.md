> **kind:** `FINDING`

## Swing WATCH play-brief "Trade manager read" narrative bullet still said "exit or cut size" for a play never entered — sibling of #5253 — FIXED

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Area** | Night Hawk Swings — Ask Largo (`tradeManagerNarrativeSection`/`breakTrigger`, `src/lib/swing/play-brief-narrative.ts`) |
| **Severity** | P2 — misleading trade-management guidance on a pre-entry setup |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — live verification after PR #5253 deployed |

### Root cause

PR #5253 (same day) fixed `resolveBreakInvalidation`'s call to `breakTrigger()` — the function that
feeds the top-level `envelope.invalidation` field — to pass a `preEntry` flag for WATCH-bucket plays,
swapping the live position-management wording ("exit or cut size" / "cover shorts") for
entry-appropriate wording ("this setup is no longer live — skip it").

`breakTrigger()` has a SECOND, independent call site: `tradeManagerNarrativeSection`'s own "Break
watch" bullet (the "Trade manager read" narrative section), at the time around line 1058 of
`play-brief-narrative.ts`. That call site was **not** updated — it still called `breakTrigger(play,
focal, flip)` with no fourth argument, so `preEntry` defaulted to `false` and the bullet kept the
OPEN-only wording regardless of the play's actual status.

#5253's own PR body asserted this second call site "never needed the fix" because it believed
`tradeManagerNarrativeSection` was OPEN-only in production ("WATCH plays render their entry state
via `watchEntrySection` instead, never `tradeManagerNarrativeSection`"). That assumption does not
hold structurally: `play-brief-intel.ts`'s real caller passes the live `bucket` straight through —
`tradeManagerNarrativeSection(ctx, bucket)` — and only `bucket === "closed"` short-circuits before
the "Break watch" line is built. `bucket === "watch"` falls through the exact same code path as
`"open"`. A pre-existing test (`play-brief-intel.test.ts:3343`) already calls
`tradeManagerNarrativeSection(ctx, "watch")` directly, confirming the function is exercised for the
watch bucket, not just OPEN.

### Evidence

Live `GET /api/market/swing/play-brief` for LITE (WATCH status), captured after #5253's fix had
deployed:
- `envelope.invalidation` (top-level field, fixed by #5253): correctly read `"...structural support
  failed; this setup is no longer live — skip it."`
- The "Trade manager read" narrative section's own "Break watch" bullet, for the SAME play in the
  SAME response: still read `"...structural support failed; exit or cut size."`

Two fields fed by the identical `breakTrigger()` logic, in the same API response, disagreeing on
whether the member holds a position — exactly the kind of internal-inconsistency defect the Largo
product contract's "precision" principle exists to prevent.

### Fix

Derived `preEntry` at the `tradeManagerNarrativeSection` call site using the identical rule
`resolveBreakInvalidation` already uses (`play.status !== "OPEN" && play.status !== "HOLD" &&
play.status !== "TRIM"`) and passed it as `breakTrigger`'s fourth argument. No change to
`breakTrigger`'s own signature or level-selection logic (both already correct and shared by both
call sites, unchanged since #5253).

### Blast radius

Only this one call site was affected — `resolveBreakInvalidation` (fixed by #5253) and
`tradeManagerNarrativeSection` (fixed here) are the only two callers of `breakTrigger` in the repo.

### Tests

`src/lib/swing/play-brief-narrative.test.ts`:
- Added `"tradeManagerNarrativeSection: WATCH-bucket Break watch uses entry-appropriate wording, not
  'exit or cut size' (2026-09-19, live LITE shape)"` (LONG).
- Added `"tradeManagerNarrativeSection: SHORT WATCH-bucket Break watch also uses entry-appropriate
  wording, not 'cover shorts'"`.
- Added `"tradeManagerNarrativeSection: OPEN-bucket Break watch still says 'exit or cut size' (no
  regression)"` to prove the fix is correctly scoped.

RED confirmed via `git stash push -- src/lib/swing/play-brief-narrative.ts` (source fix only, test
changes kept): both new WATCH-bucket tests failed with the exact pre-fix "exit or cut size"/"cover
shorts" strings (94 pass / 2 fail). GREEN after restoring the fix (96 pass / 0 fail). Full suite
(Node 20, `npm test`) and `tsc --noEmit` both clean — see PR for exact counts.
