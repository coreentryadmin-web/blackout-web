# Ask Largo swing play-brief's "Data freshness" section narrated live desk staleness on CLOSED (historical) positions

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (product-honesty/trust — a historical trade record narrated present-tense claims about "today's" live desk state, which reads as if a resolved position still needs live monitoring) |
| **Area** | Night Hawk Swings / Ask Largo — `src/lib/swing/play-brief-intel.ts` (`dataFreshnessSection`); consumed by `GET /api/market/swing/play-brief`'s "Data freshness" section for CLOSED rows |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — 2026-09-12 5-engine + Largo deep-dive cycle |

## Root cause

`play-brief-absence.ts`'s `collectBriefUnavailableSources` (the structured `unavailableSources`
array that drives the UI's `UnavailableChip`) already gates HELIX-flow/GEX-matrix/Vector/
discovery-scan staleness behind `status !== "CLOSED"`, with its own detailed comment explaining
why: those checks all measure whether **today's** live desk state is current, which stops being a
meaningful question the moment a play is a historical record, not a live position — left ungated,
"these are individually honest but collectively permanent once ANY time has passed since close...
producing a wall of true-but-unhelpful negative chips" (live evidence cited there: a CLOSED AAPL
play showing six such chips and nothing else).

`play-brief-intel.ts`'s `dataFreshnessSection` — the narrative "Data freshness" section BODY text,
a separate code path from that structured absence array — computes the exact same four staleness
facts (discovery-scan session lag, Vector data age, GEX matrix age, HELIX pipeline freshness) but
never received the matching `isClosed` gate. So the same "fires forever" failure the
`unavailableSources` fix specifically prevents was still reachable through this section's prose,
just via a different code path nobody had gated the same way.

## Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:INTC&ticker=INTC&status=CLOSED` (2026-09-12,
authenticated via `scripts/audit/lib/prod-clerk-session.mjs`) — INTC's real CLOSED position
(`positionId`, closed **2026-09-04 07:00 ET**, stopped at -33.2%), read a full **week** after
close:

```
=== Data freshness ===
Swing scan: **2026-09-11 16:33 ET** (**prior session 2026-09-11** — today's discovery not yet run)
HELIX flow: **pipeline stale** — tape read may lag; not evidence of quiet flow
```

Both lines assert something about "today"/"not yet run" on a trade that has been closed for a
week — exactly the failure mode `collectBriefUnavailableSources`'s own comment describes, just
manifesting in the narrative section instead of the structured `unavailableSources` array (whose
`isClosed` gate correctly suppressed the equivalent chips for this same INTC row — confirmed
`unavailableSources: []` on the same response).

## Blast radius

Only `dataFreshnessSection` was affected — `collectBriefUnavailableSources` (the structured array)
was already correct. No other section in `play-brief-intel.ts` independently re-derives
scan/Vector/GEX/HELIX staleness prose, so this was the single call site with the gap.

## Fix

Wrapped the scan-staleness, Vector-data-age, GEX-matrix-age, and HELIX-pipeline-stale lines in
`dataFreshnessSection` behind the same `String(play.status ?? "").toUpperCase() === "CLOSED"` gate
`collectBriefUnavailableSources` already uses, with a comment cross-referencing that file's
rationale so the two gates cannot silently drift apart again. The option-mark lines are untouched:
`playExpectsLiveOptionMark` already scopes the live-mark-staleness claim to OPEN/HOLD/TRIM, and a
bare `markAsOf` timestamp (when present) is a historical fact rather than a staleness claim, so it
was already correct for CLOSED rows.

**Why this fix and not removing the section entirely for CLOSED rows**: a CLOSED play with a
genuine data-quality fact worth surfacing (e.g. a real fetch failure, handled elsewhere) should
still be able to render one; the fix only removes the specific "today's state" claims that cannot
be true/false about a historical record, not the whole section unconditionally.

## Tests

Added to `src/lib/swing/play-brief-intel.test.ts`:
- `dataFreshnessSection: CLOSED play suppresses prior-session scan staleness narration`
- `dataFreshnessSection: CLOSED play suppresses stale HELIX pipeline narration`
- `dataFreshnessSection: CLOSED play suppresses stale GEX matrix and Vector data-age narration`
- `dataFreshnessSection: an OPEN play with the exact same stale inputs still narrates them (not
  over-suppressed)` — guards against a gate that's too broad, not just one that's missing.

Verified RED before the fix (git-stashed `play-brief-intel.ts` only, kept the new/extended tests):
3 of 96 tests in `play-brief-intel.test.ts` fail. GREEN after: 96/96 pass. Full `npm test` (Node
20) and `npx tsc --noEmit` both clean.

## Market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` (#136) — during the next RTH session, pull a real
CLOSED Swing position's play-brief and confirm its "Data freshness" section no longer claims
"today's discovery not yet run" / "HELIX flow: pipeline stale" / stale GEX/Vector data-age for a
trade that closed in a prior session.
