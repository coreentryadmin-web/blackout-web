> **kind:** FINDING

# Legacy healthcheck had no cross-check between the morning-confirm verdict and the edition's pulled overlay — new Stage D

| Field | Detail |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (audit-tooling coverage gap, not a live production defect) |
| **Component** | `scripts/audit/legacy-e2e-healthcheck.mjs`, `scripts/audit/lib/legacy-healthcheck-eval.mjs` |
| **Found via** | Aggressive improvement-hunting pass, 2026-09-11, after live-tracing today's AAPL/SWKS morning-confirm pull event |

## What was missing

While tracing today's live morning-confirm outcome (both AAPL and SWKS pulled pre-open by a
Cortex `gex-walls` veto), I found there are **two independently-read surfaces** describing the
same event:

1. `GET /api/nighthawk/play-status?date=...` — the CONFIRMED/DEGRADED/INVALIDATED/UNVERIFIED
   verdict the 9:15am ET `nighthawk-morning-confirm` cron writes, served from a Redis cache
   (`nh:play-status:{date}`) with a DB fallback (`morningStatusFromDb`) if the cache is empty.
2. `GET /api/market/nighthawk/edition` — the `pulled`/`pulled_reason` fields, merged onto the
   published edition payload at READ time by `pull-overlay.ts` from the same underlying
   `nighthawk_play_outcomes` DB row (`recordNighthawkMorningVerdict` is the single write path
   for both: it sets `morning_verdict` AND latches `pulled`/`pulled_reason` in one UPDATE).

Both trace back to one write, so under normal operation they always agree — confirmed live
today, all GREEN. But the existing `legacy-e2e-healthcheck.mjs` (Stages A/B/C) never checked
`/api/nighthawk/play-status` at all, so if the two surfaces ever DID disagree — e.g. a member
sees a play struck through as "Pulled" with no matching morning-confirm status badge, or a
morning-confirm INVALIDATED badge with no pulled styling on the same play — nothing in the
standing per-cycle healthcheck would have caught it. That is exactly the kind of member-visible
split-brain this lane's mandate exists to catch.

## What changed

Added Stage D (`verdictForPullConsistency` in `legacy-healthcheck-eval.mjs`, wired into the
runner as `checkPullConsistency`): for every play in today's edition, look up the matching
`play-status` verdict by ticker and assert `pulled === (status === "INVALIDATED")`. A mismatch
in either direction is RED with an explicit "split-brain" evidence string naming both sides. A
ticker with no recorded verdict at all is AMBER (not RED — the cron may not have evaluated every
published ticker, e.g. a play added after the cron's pass). Before the cron has fired for a given
date (overnight / pre-9:15am ET), `play-status` honestly returns `available: false` and the new
stage reads SKIPPED, matching this file's existing "never fabricate a verdict for a stage that
hasn't run yet" convention (`rollupVerdict`'s own SKIPPED handling).

## Evidence

- 13 new unit tests in `legacy-healthcheck-eval.test.mjs` covering: fetch failure (RED),
  not-yet-run (SKIPPED), agreement both directions (GREEN), both split-brain directions (RED),
  missing verdict (AMBER), empty edition (GREEN), and one-bad-ticker-drags-the-stage (RED). Full
  file: 39/39 pass.
- Live-verified against production: `npm run healthcheck:legacy -- --json` now reports Stage D
  `GREEN` for both AAPL and SWKS today, each reading `"INVALIDATED <-> pulled=true agree"` —
  confirming the two surfaces really do agree on the live 2026-09-11 pull event, and that the new
  stage reads the real API shapes correctly (not just the unit fixtures).
- `tsc --noEmit` clean.
- Full suite run alongside this change (see PR for pass count).

## Blast radius

New stage only — no existing stage's logic (A/B/C) touched. `verdictForPullConsistency` is a new
pure function with no other callers. The new `checkPullConsistency` fetch is READ-ONLY, hits an
already-existing member-facing route (`/api/nighthawk/play-status`, same auth/tier gate as
`/edition`), and adds one HTTP call per healthcheck run — negligible.

## Fix rationale

Chose a per-ticker cross-check over, say, only checking the `summary.invalidated` count against
the edition's own pulled count, because a count-only check can't catch a mismatch that nets to
zero (ticker A wrongly not-pulled, ticker B wrongly pulled — same total, real bug hidden). The
per-ticker evidence array also gives the next cycle immediate, specific detail if this ever does
go RED, rather than a bare "N mismatches" needing a manual re-derivation.
