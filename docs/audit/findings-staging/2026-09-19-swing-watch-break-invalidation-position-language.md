> **kind:** `FINDING`

## Swing WATCH play-brief "Invalidation" callout told members to "exit or cut size" a position that was never entered — FIXED

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Area** | Night Hawk Swings — Ask Largo (`resolveBreakInvalidation`/`breakTrigger`, `src/lib/swing/play-brief-narrative.ts`) |
| **Severity** | P2 — misleading trade-management guidance on a pre-entry setup |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — live play-brief deep-dive on LITE's WATCH brief, cross-checked against `play-brief.test.ts`'s own fixtures |

### Root cause

`breakTrigger` (`src/lib/swing/play-brief-narrative.ts`) always closed its "Break watch" line with
live position-management language — `"...structural support failed; exit or cut size."` for LONG,
`"...resistance broken; cover shorts."` for SHORT — regardless of whether the play had ever been
entered. `resolveBreakInvalidation` (which feeds `play-brief.ts`'s top-level `envelope.invalidation`
field, the UI's labeled "Invalidation" callout) calls `breakTrigger` for every non-CLOSED bucket,
including WATCH.

A CLOSED-bucket version of this exact defect shipped and was fixed earlier (see FINDINGS.md,
"Swing play-brief 'Invalidation' callout showed live 'exit or cut size' guidance for CLOSED plays")
— that fix added a `bucket === "closed"` short-circuit before the fallback chain. But the fix
stopped one bucket short: WATCH (a setup that has never been entered — nothing to "exit" or "cut
size") kept using the identical OPEN-only wording. The gap survived because the prior investigation
explicitly noted `tradeManagerNarrativeSection`'s own in-body "Break watch" bullet is already
bucket-gated (only rendered for open/watch) and treated that as sufficient — it never asked whether
the WORDING was appropriate for the watch bucket, only whether the section RENDERED for it. In
practice, WATCH plays render their entry state via `watchEntrySection` instead (never
`tradeManagerNarrativeSection`), so the misleading wording only ever reached the standalone
top-level `envelope.invalidation` field, not the narrative body.

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:LITE&ticker=LITE&status=WATCH` (2026-09-19,
LITE genuinely on WATCH, entry blocked by the `legacy_exempt` gate, thesis intact, 4 days left in
the entry window):

```
"invalidation": "**Break watch** — lose **800.00** on a closing basis → structural support failed; exit or cut size."
```

Nothing has been entered on this ticker — there is no position to exit or cut. Confirmed this was
already locked into the test suite's own expectations, not just a live anomaly: `play-brief.test.ts`'s
`"composeSwingPlayBrief: invalidation prefers a real per-ticker technical break level..."` test uses
`fixturePlay()` with no `status` override — `fixturePlay`'s default `status` is `"WATCH"` — and
asserted the exact literal `"exit or cut size"` string as the expected, correct output.

### Blast radius

Single function (`breakTrigger`), single caller chain (`resolveBreakInvalidation` →
`play-brief.ts`'s `envelope.invalidation`). `tradeManagerNarrativeSection`'s own call to
`breakTrigger` (the in-body "Trade manager read" bullet) is OPEN-only in production (WATCH renders
`watchEntrySection` instead), so it was never affected by the bug and is unaffected by the fix — it
calls the 3-arg form, `preEntry` defaults to `false`.

### Fix

Added an optional `preEntry` parameter to `breakTrigger` (default `false`, preserving existing
OPEN-play behavior byte-for-byte). `resolveBreakInvalidation` now derives `preEntry` from
`play.status` (`true` unless `OPEN`/`HOLD`/`TRIM` — CLOSED never reaches this function, already
short-circuited by the caller) and passes it through. When `preEntry` is true, both the LONG and
SHORT branches swap their trailing clause to `"this setup is no longer live — skip it"` — the same
phrasing convention already used elsewhere in this file for a dead WATCH play (`deadPlayReason`'s
own text in `play-brief.ts`). The level-selection logic (support/resistance/king/flip candidates) is
completely unchanged and was already correct for both buckets.

### Fix rationale

Reusing the exact phrase `watchEntrySection`'s sibling code already uses for a dead setup keeps the
member-facing voice consistent rather than inventing new wording. Deliberately did not touch
`tradeManagerNarrativeSection`'s call site (which never needed the fix) or the level-selection
predicates (already correct, covered by their own 2026-09-11/09-15 fixes).

### Tests

`src/lib/swing/play-brief.test.ts`:
- Updated `"composeSwingPlayBrief: invalidation prefers a real per-ticker technical break level..."`
  (WATCH-status fixture) to assert the corrected wording.
- Added `"composeSwingPlayBrief: OPEN play's invalidation callout keeps live position-management
  wording ('exit or cut size')"` — proves the fix is correctly scoped and does not regress the OPEN
  case.

RED confirmed via `git stash push -- src/lib/swing/play-brief-narrative.ts` (source fix only,
test changes kept): the WATCH-wording test failed with the exact pre-fix string. GREEN after
restoring the fix. Full suite: `npm test` (Node 20) — 14871 pass / 0 fail / 3 skipped. `tsc --noEmit`
clean.
