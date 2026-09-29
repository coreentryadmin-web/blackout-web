# Night Hawk Legacy: a play whose outcome row is created after 9:15am ET never gets its morning verdict/pull latch — FIXED

> **kind:** `FINDING`

| Field | Value |
|---|---|
| **Status** | FIXED — PR pending, admin route `POST /api/admin/nighthawk/replay-morning-verdicts` |
| **Severity** | P1 (member-facing) |
| **Area** | Night Hawk Legacy — morning-confirm pull latch |
| **Found** | 2026-09-29, live, while closing out PR #5569 (`nighthawkRepublishMissingOutcomeRows_2026_09_29`) |

## Context

PR #5569 (merged 2026-09-29 14:02 UTC) fixed `republishBackfilledEdition` to call
`syncNighthawkPlayOutcomes` so a BACKFILL play always gets a `nighthawk_play_outcomes` row. That
fix is structural/prevention: it guarantees a row EXISTS. It does not, and structurally cannot,
retroactively populate that row's `morning_verdict`/`pulled` fields for a play whose row didn't
exist yet when `/api/cron/nighthawk-morning-confirm` fired at 9:15am ET — the cron runs once per
`edition_for` and `persistNighthawkMorningVerdicts`'s write silently no-ops (`missing_rows`) for
any ticker with no matching row at that moment, by design (to tolerate a publish-time sync failure
gracefully rather than crash the cron).

Confirmed live 2026-09-29: BB's outcome row was created ~15:03 UTC (via the republish-backfill
repair pass, now that PR #5569 is deployed) — well after the 9:15am ET cron already ran and wrote
its Redis-cached verdict at 13:15:15Z. `legacy-e2e-healthcheck.mjs`'s stage D was STILL RED for BB
after the row existed, because the `pulled` flag was never latched onto it.

## Why not just re-invoke the cron with `?force=1`?

Considered and rejected. `GET /api/cron/nighthawk-morning-confirm?force=1` would:
1. **Recompute** each play's verdict against CURRENT (mid-day) market data, mislabeled
   "premarket" in the Redis blob and markdown file — not a replay of the already-correct 9:15
   verdict.
2. **Overwrite** `nh:play-status:{date}` in Redis for ALL plays (AMD, BB, ZS), not just the one
   with a gap — members would see the panel's numbers change to confusing mid-day readings.
3. Could, in principle, compute a genuinely DIFFERENT verdict for BB than the one already
   computed and shown at 9:15am, since market conditions moved in the intervening hours — a real
   behavioral risk, not just cosmetic.

This crosses from "mechanical infra-completeness fix" into "a decision with live-picks-logic
blast radius" per this repo's own escalation discipline (CLAUDE.md issue-handling policy) — so it
was not self-executed.

## The fix actually shipped

New admin route `POST /api/admin/nighthawk/replay-morning-verdicts { edition_for }`
(`src/app/api/admin/nighthawk/replay-morning-verdicts/route.ts`):
- Reads the SAME cached Redis blob (`nh:play-status:{edition_for}`) the 9:15am cron already wrote
  — the actual verdict already computed and shown to members all day.
- Calls the existing, unmodified `persistNighthawkMorningVerdicts(...)` (the exact function the
  cron itself calls), sourcing `playStatuses`/`market` from that cache instead of fresh
  Polygon/platform-intel reads.
- Never writes back to Redis — read-only w.r.t. the cache, so the panel's already-correct 9:15
  snapshot is untouched.
- `recordNighthawkMorningVerdict` (db.ts) is COALESCE-based (first-write-wins): a ticker that
  already has a persisted verdict (AMD, ZS) is structurally untouched by re-running this; only a
  ticker whose row is still missing a verdict (the actual gap — BB) gets written, with the SAME
  status/reason string already published, never a new one.

This is a pure replay of already-decided, already-member-visible data — not a new decision, not a
recomputation, not a Redis write. Idempotent and safe to re-invoke.

## Blast radius

Only the new route file + its test. No existing file modified. `persistNighthawkMorningVerdicts`,
`recordNighthawkMorningVerdict`, the morning-confirm cron route, and `republish-backfill` are all
untouched.

## Test plan

- Source-inspection regression test (`route.test.ts`) — same idiom as
  `post-publish-backfill.test.ts` (the route needs `@/lib/db`/`@/lib/make-redis`, which can't be
  safely mocked in this test environment without breaking the `"@/"` alias across the whole loaded
  graph). Asserts: admin-gated; `playStatuses`/`market` are sourced from `cached.*`, never freshly
  computed; the route never calls `redis.set(`; `edition_for` is required with no implicit
  "latest" default.
- `npx tsc --noEmit` clean.
- Full suite: 15666/15666 pass (3 pre-existing skips, unrelated).

## Follow-up

Once deployed, invoke once for `edition_for: "2026-09-29"` to complete today's repair (BB's
`pulled` flag) — the row now exists (PR #5569), this closes the loop by replaying its
already-known verdict onto it.
