# Swing play-brief's "Night Hawk Legacy" absence chip misreports a stale per-ticker gap as "today's edition not yet run" — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-swing-brief-legacy-stale-ticker-misclaim |
| **Priority** | P2 |
| **Area** | Ask Largo — Night Hawk Swings play-brief (`src/lib/swing/play-brief-absence.ts`) |
| **Status** | FIXED |

## Symptom

Found during the standing Ask Largo deep-dive mandate (2026-09-10), checking a WATCH-bucket swing
play-brief for GOOG (`GET /api/market/swing/play-brief?playId=SWING:GOOG&ticker=GOOG`). The
envelope's `unavailableSources` included:

```json
{ "source": "Night Hawk Legacy", "reason": "prior session (2026-08-03) — today's edition not yet run" }
```

`2026-08-03` is over 5 weeks before the check date (2026-09-10). Cross-checked against the real
Legacy edition endpoint, `GET /api/market/nighthawk/edition`, which showed:

```
edition_for: 2026-09-10
published_at: 2026-09-09T21:34:32.000Z
```

Legacy's pipeline was fine — published on schedule the evening before, exactly as expected pre-5:30pm
ET (same pattern already ruled out this session for the edition healthcheck, PR #4749). The
play-brief's claim that "today's edition not yet run" was false and unverifiable from the data it
was actually reasoning from.

## Root cause

`ctx.ecosystem.nighthawk_recent` (`fetchEcosystemContext`, `src/lib/bie/ecosystem-context.ts`) is
populated by:

```sql
SELECT edition_for, direction, conviction, outcome, score
FROM nighthawk_play_outcomes
WHERE ticker = $1
ORDER BY edition_for DESC
LIMIT 1
```

This has **no date filter** — it returns the last time *this specific ticker* appeared in a Legacy
edition, however long ago that was. Compare that to the sibling "0DTE Command" absence check a few
lines above, whose underlying query (`zerodte_setup_log WHERE ticker = $1 AND session_date = $2`
pinned to today) can only ever be non-null when there IS a same-day row — so it is structurally
immune to this exact bug. The Legacy query has no such pin.

`play-brief-absence.ts`'s Legacy chip then compared this per-ticker "last featured" date directly
against `ctx.sessionDate` and, on any mismatch, asserted `"today's edition not yet run"` — a
system-wide claim about Legacy's publish pipeline that the per-ticker data can never actually prove.
For any ticker Legacy hasn't picked in the last few days (the overwhelming majority of the
universe, on any given day), this chip would ALWAYS fire with a stale date and this exact false
claim, regardless of whether Legacy's edition had, in fact, published on time that very evening.

This is the same class of defect this file's own comment block already documents twice over (the
Largo C4 "wrong identity is worse than missing" fix, and the C3 "an unbanked peak is a loss shown
as a gain" pattern) — just on the *freshness* axis instead of the *product-label* axis: a
plausible-looking, precise-sounding claim ("today's edition not yet run") that is actually
unsupported by the data behind it.

## Evidence

Live capture (one temp Clerk premium session, deleted after), 2026-09-10 ~21:11 UTC:
- `GET /api/market/swing/play-brief?playId=SWING:GOOG&ticker=GOOG` → `unavailableSources` includes
  `{"source":"Night Hawk Legacy","reason":"prior session (2026-08-03) — today's edition not yet run"}`.
- `GET /api/market/nighthawk/edition` (same session) → `edition_for: 2026-09-10`,
  `published_at: 2026-09-09T21:34:32.000Z` — the real edition is current, not stale.
- Query behind `nighthawk_recent` confirmed by reading `ecosystem-context.ts:758-770` directly
  (`WHERE ticker = $1 ORDER BY edition_for DESC LIMIT 1`, no date bound).

RED→GREEN, `src/lib/swing/play-brief-absence.test.ts` (1 new test using the exact live GOOG
numbers): `git stash push -- src/lib/swing/play-brief-absence.ts` → 42/43 pass, 1 fail (the new
assertion expecting the reworded, non-claiming reason string got the old false claim instead);
`git stash pop` restores 43/43 pass. `npx tsc --noEmit` clean.

## Blast radius

Single call site: `collectBriefUnavailableSources`'s Legacy chip is the only place
`nighthawk_recent.edition_for` is compared against `ctx.sessionDate` for a "today's edition"
freshness claim (grepped `today's edition not yet run` repo-wide — one hit, this file). The
existing near-term case (a 1-day-old ticker record, still plausibly "today's edition hasn't run
yet this cycle") is preserved unchanged and still covered by its own pre-existing test. No other
consumer reads this exact reason string, and no schema/query change was needed.

## Fix rationale

Bounded the existing "today's edition not yet run" claim to a small gap window (1-4 calendar days,
covering a normal weekend) where it remains a plausible same-cycle read. Beyond that window, the
chip still surfaces (the underlying fact — this ticker hasn't been in a recent Legacy edition — is
real and worth knowing) but with an honest, ticker-scoped reason
(`"no recent Legacy edition for this ticker (last featured <date>)"`) that does not assert
anything about whether today's system-wide edition ran. Deliberately did not touch the sibling
0DTE/discovery-scan checks in the same function — those are pinned to today's date at the query
layer and are not subject to this failure mode; touching them would be unevidenced scope creep.
A system-wide "has Legacy published today" signal (which would let this chip drop the guess
entirely) does not currently exist in `EcosystemContext` and adding one is a larger, separate
change — out of scope for this single-issue fix.
