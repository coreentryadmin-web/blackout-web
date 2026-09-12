> **kind:** FINDING

## Ask Largo CLOSED-play brief's "Desk context" cited a Legacy pick dated AFTER the trade's own exit — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`deskConsensusSection` (`play-brief-intel.ts`) narrates the last time Night Hawk Legacy featured
this ticker (`eco.nighthawk_recent`). A staleness gate added 2026-09-10 (for a different bug —
a Legacy pick weeks old reading as current sizing context) compares `nighthawk_recent.edition_for`
against `sessionDate` (today) for every bucket, suppressing the section when the gap exceeds 4
days. That gate answers "is this pick recent relative to today" — the right question for an
OPEN/WATCH position (a live decision being made today), but the wrong one for a CLOSED position,
whose relevant question is "could this pick have existed at the time the trade was actually live."
Comparing against "today" instead of the trade's own exit date meant a CLOSED play's brief could
cite a Legacy pick from AFTER the trade closed — impossible to have informed that decision — as
long as the pick happened to fall within 4 days of "today" at read time.

### Live repro (2026-09-12, real CLOSED position AAPL, positionId 36)

`GET /api/market/swing/play-brief?playId=SWING:AAPL:36&ticker=AAPL&status=CLOSED&positionId=36` —
this position closed **2026-09-04** (STOPPED, -56.2%). The same response's "Desk context" section
read:

> Night Hawk Legacy's last pick on this name (**2026-09-11**) is still **unresolved** — for
> reference against the **LONG** setup this play traded.

`2026-09-11` is 7 days AFTER the trade's own 2026-09-04 exit — the existing gate only checked that
it was within 4 days of "today" (2026-09-12), which it was (1 day), so the section rendered
unconditionally. The CLOSED-bucket tail wording ("for reference against ... the setup this play
traded") asserts this pick is retrospective context for the trade — but a pick from the future
relative to the trade's own timeline cannot be that.

### Fix

For `bucket === "closed"`, the gate's reference date is now the play's own exit date
(`etSessionDate(Date.parse(play.exitAt))`) instead of `sessionDate`. The gate additionally rejects
`gapDays < 0` (the Legacy pick postdates the reference date) alongside the existing `gapDays > 4`
(too stale) — the sessionDate-only gate could never trip the new `< 0` case, since Legacy history
is never dated after "today," but very much can postdate an already-closed trade read some time
later. OPEN/WATCH buckets are completely unchanged (still gated against `sessionDate` exactly as
before).

### Blast radius

Single function (`deskConsensusSection`), single gate. No other call site.

### Fix rationale

Considered simply raising the CLOSED-bucket gate's threshold or dropping it for CLOSED entirely,
but neither addresses the actual defect — the problem isn't "how stale is too stale," it's "stale
relative to WHAT." Anchoring the reference date to the play's own exit date for CLOSED (rather than
today) is the minimal change that makes the existing gap-day math answer the right question, and
the added `< 0` check is the one new case that question surfaces.

### Evidence of testing

- Two new tests in `play-brief-intel.test.ts`: one reproduces the exact AAPL#36 case (`exitAt:
  "2026-09-04...", edition_for: "2026-09-11"`) and asserts the section is now suppressed; a sibling
  test confirms a Legacy pick dated at-or-before the exit, within the window, still narrates
  normally.
- RED confirmed pre-fix (isolated pattern-match run): the live-repro test failed with the actual
  rendered anachronistic text; GREEN confirmed post-fix (both new tests + full file, 115/115 pass).
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20.20.2): see PR for final count.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, pulling
AAPL#36's full live CLOSED play-brief for a fresh Ask Largo deep-audit pass.
