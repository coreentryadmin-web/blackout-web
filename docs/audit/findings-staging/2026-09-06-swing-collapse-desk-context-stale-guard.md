# Ask Largo swing brief collapse — "Desk consensus" stale entry left unguarded after #4123's partial fix

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (preventive — currently accidentally safe, not an active production bug) |
| **Area** | Swing / Ask Largo intel-section collapse layer |
| **Files** | `src/lib/swing/play-brief-intel-collapse.ts`, `src/lib/swing/play-brief-intel-collapse.test.ts` |

## Context

#4123 fixed the active P1 regression from #4119 (`collapseRedundantIntelSections()` silently
dropping "Book context" post-#4116). While investigating that same bug independently, this session
found a second, related staleness in the same 10-line `NARRATIVE_COVERED_TITLES` set: it still
lists `"Desk consensus"`, a title that hasn't existed since #4111 renamed that section to
`"Desk context"`. #4123 did not remove it (out of scope for that PR — it only targeted "Book
context").

Unlike the Book-context bug, `"Desk consensus"` is **not currently causing data loss** — it's a
dead string that matches nothing, so `"Desk context"` sections survive collapse today by accident,
not by design. The risk is forward-looking: `deskConsensusSection` (play-brief-intel.ts) carries
NH outcome-history and flow-anomaly content that #4111 deliberately kept supplementary (only the
direction-conflict part moved into `crossDeskCoaching`). A future dead-code/stale-reference cleanup
(exactly the class of PR this repo runs routinely — see #4118, a `largoModuleStarterCards` cleanup
merged the same session) could "helpfully" rename `"Desk consensus"` → `"Desk context"` to match
the actual title, without realizing that re-enables the collapse and silently deletes that
supplementary content — repeating the exact #4116/#4119 bug class for a second section.

## Fix

Removed the stale `"Desk consensus"` entry entirely (not renamed to `"Desk context"`) and added a
doc comment on `NARRATIVE_COVERED_TITLES` explaining why both "Book context" and "Desk context" are
excluded, so a future contributor reads the reasoning before "fixing" what looks like a stale
reference. Added a regression test asserting "Desk context" survives collapse when narrative leads.

## Evidence

New test passes both before and after this change (4/4, including pre-existing tests) — this
confirms the current behavior is genuinely safe today, not that the test is vacuous; its value is
locking that safety in explicitly so it can't regress silently via a future rename. `tsc --noEmit`
clean. Full `npm test` (Node 20): **12914/12914 pass, 0 fail, 3 skipped**.

## Blast radius

Only the collapse constant set + its test file. No behavior change today (the string already
matched nothing) — this closes the door on a specific future regression.

## Fix rationale — what was deliberately left unchanged

- Did not touch `deskConsensusSection` or `crossDeskCoaching` — this is purely about preventing the
  collapse list from silently reincluding "Desk context" later.
- Did not open this as a follow-up to #4124 (closed in favor of #4123, which only addressed Book
  context) — reopening a closed PR mid-race seemed likelier to cause more confusion than a small,
  clearly-scoped new PR for the one remaining piece.
