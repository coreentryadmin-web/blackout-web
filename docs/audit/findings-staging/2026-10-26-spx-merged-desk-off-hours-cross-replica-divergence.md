## SPX Slayer off-hours play read: `spx-merged:<date>` goes fully cold overnight, so different ECS replicas serve non-monotonic, diverging "current" scores

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #6822, pending merge to `main`) |
| **Found by** | Ask Largo × Night Hawk Swings / 5-engine live monitor standing mandate — live audit cycle against `GET /api/market/spx/play`, 2026-10-26, pre-7am ET (pre-cash-open, real Wednesday trading day) |
| **Scope** | `src/features/spx/lib/spx-service.ts` (`evaluateSpxPlayState`, new `maybeRefreshMergedSpxDeskOffHours` helper), `src/lib/providers/config.ts` (new `spxMergedDeskOffHoursRefreshIntervalSec`) |

### Root cause

`evaluateSpxPlayState()`'s off-hours shortcut (added 2026-10-18, PR history in the function's own
comment) answers "is the market closed right now" by calling `peekMergedSpxDesk({ maxStaleMs: 24 *
60 * 60 * 1000 })` — a Redis/L1-only **peek** of the `spx-merged:<date>` cache, deliberately never
calling the real `loadMergedSpxDesk()` loader, with a 24-hour staleness tolerance. That tolerance
was chosen under the stated assumption (the function's own comment): "once the market is genuinely
closed, 'stale' and 'correct' are the same thing... a generous staleness ceiling is safe here
specifically."

That assumption holds for the simple after-close case (4:15pm ET Friday → Monday pre-market: the
underlying desk genuinely does not change). It does **not** hold for the **pre-7am-ET window**
specifically: SPX futures/overnight tape continues moving, so the desk snapshot a replica happens
to have cached is NOT "the same as current," it is a genuinely stale *past* reading whose score can
legitimately differ from a more-recently-cached reading.

Worse, outside `isSpxEngineCronWindow()` (before 7am / after 4:15pm ET / weekends), **nothing else
in the app calls the real `loadMergedSpxDesk()` loader either** — no cron tick (all RTH-gated), and
the off-hours play-read path itself only ever peeks. So once `spx-merged:<date>`'s own short Redis
TTL (`deskCacheTtlMs()`, 10s default) lapses with nothing refreshing it, `peekServerCache`
(`src/lib/server-cache.ts`) falls through to its tier-3 local-fallback: each ECS replica's own
per-process in-memory copy, independently aged by however long it's been since THAT specific
replica last happened to run a real `loadMergedSpxDesk()` (e.g. incidental traffic to
`GET /api/market/spx/merged`). Different replicas can therefore be stale by very different amounts
at the same wall-clock instant — and a member's consecutive polls of `/api/market/spx/play`, load-
balanced across replicas, can land on different replicas each time.

This is a **different, sharper manifestation** than the one the 2026-10-25 finding ("PR #6719's 20s
freshness bound rejected every closed-market cached play snapshot...") explicitly traced and
deliberately deferred as "a separate, lower-priority observation... the frozen `as_of` itself is
legitimate display behavior." That finding's own live evidence showed a single `as_of` value
**frozen** (unchanging) across consecutive polls — consistent with one replica serving one stale-
but-self-consistent copy. The live evidence here shows two DIFFERENT replica-local vintages served
across the SAME 60-second polling window, with `as_of` jumping **backward** and the DERIVED SCORE
changing (4, then 6) for what a member sees as "the current SPX Slayer read" — not merely frozen,
but non-monotonically divergent.

### Evidence

Live, 2026-10-26, ~06:4x AM ET (pre-cash-open, real Wednesday trading day — not a holiday/weekend),
via `scripts/audit/lib/prod-clerk-session.mjs`'s `mintClerkPremiumSession` (temp Clerk user, deleted
after):

- `GET /api/market/spx/desk` across 4 polls ~20s apart: `as_of` age 49s / 37s / 57s / 78s —
  consistently fresh (this route reads the SEPARATE, independently-refreshed `spx-desk:<date>`
  cache key via `loadSpxDesk()`/`peekSpxDesk()`, unaffected by this bug).
- `GET /api/market/spx/play` on the SAME 4 polls (reads `spx-merged:<date>` via this off-hours
  shortcut): poll0 `as_of=2026-10-26T10:36:47.424Z` (age 268s); poll1 (+20s) **identical** `as_of`
  (age 288s — frozen, one replica); poll2 (+20s) `as_of` **jumped backward** to
  `2026-10-26T10:19:08.025Z` (age 1368s / ~22.8min) with the computed **score changing from 4 to
  6**; poll3 (+20s) unchanged at `10:19:08` (age 1388s).
- Traced in the current source (this PR's parent commit, pre-fix): `evaluateSpxPlayState()`
  (`spx-service.ts` ~L109-134), `peekMergedSpxDesk()`/`loadMergedSpxDesk()`
  (`spx-desk-loader.ts`), and `peekServerCache()`'s three-tier local/Redis/local-stale-tolerant
  fallback (`server-cache.ts` ~L481-497) — confirmed the off-hours branch never reaches
  `loadMergedSpxDesk()` (the real loader) unless the peek itself comes back empty or shows the
  market open, and confirmed `peekServerCache`'s tier-3 fallback is a per-process `Map`, not shared
  across replicas.

### Fix

Added `maybeRefreshMergedSpxDeskOffHours()` (`spx-service.ts`): fired (non-blocking, `void`) from
inside the existing off-hours closed-market branch, right before building the closed-market
snapshot. It throttles via `sharedCacheSetNx` on a dedicated, date-scoped lock key
(`spx-merged-desk-bg-refresh:<date>`) with a TTL from the new
`spxMergedDeskOffHoursRefreshIntervalSec()` config helper (`src/lib/providers/config.ts`, default 5
minutes, env-overridable via `SPX_MERGED_DESK_OFF_HOURS_REFRESH_SEC`); only the replica that wins
the throttle lock actually calls the real `loadMergedSpxDesk()`. This keeps `spx-merged:<date>`'s
shared Redis value refreshed often enough that every replica's own short-TTL local entry reliably
re-syncs from the shared, generation-guarded Redis value (`server-cache.ts`'s `writeRedisCache`)
instead of falling through to its own independently-stale local fallback — bounding cross-replica
divergence to the refresh interval instead of letting it grow unboundedly across the whole
15-hour off-hours window.

### Fix rationale

Considered and rejected: tightening `peekMergedSpxDesk`'s `maxStaleMs` argument directly. That would
re-open the exact bug the 2026-10-18 fix (referenced in `evaluateSpxPlayState`'s own comment) fixed
— a tight bound would force the SLOW, blocking `loadMergedSpxDesk()` path on the very next request
whose local copy ages past it, which can take longer than the outer `playMemberReadMaxBlockMs()`
budget (800ms) and throw `ServerCacheTimeoutError` again. Kicking a background refresh instead keeps
the fast, non-blocking member-facing read completely unchanged while fixing the underlying cache
staleness at its source. Deliberately NOT restoring full trading-hours (10s) refresh cadence
off-hours — the throttle keeps background provider load modest (at most one refresh per interval,
cluster-wide) rather than hammering Polygon/UW all night, which would be its own kind of scope creep
this fix does not need. Left unchanged: the 2026-10-25 fix's own `isSpxPlaySnapshotShareable`
cross-replica PLAY-cache-read logic (a different cache key, `spx-play-read:<date>`, already
correctly tolerant of legitimate closed-market staleness) — this fix addresses the UNDERLYING
`spx-merged:<date>` desk cache the 2026-10-25 finding explicitly named as the deferred, lower-
priority piece, not the play-cache read logic that finding actually fixed.

### Blast radius

`spx-merged:<date>` is read by every consumer of `peekMergedSpxDesk()`/`loadMergedSpxDesk()` during
the off-hours window: `GET /api/market/spx/play` (this bug's live repro), `GET /api/market/spx/merged`,
and BIE/Largo's `get_spx_play`/`spx_full_state` tools, all of which share this one cache lane — the
fix benefits all of them, not just the `/play` route this bug was caught on.

### Regression tests

Added `src/features/spx/lib/spx-service-merged-desk-bg-refresh.test.ts` — two tests exercising the
real, exported `evaluateSpxPlayStateCrossReplica()` (not source-regex) with `spx-desk-loader`,
`spx-play-session-guards`, `spx-evaluator`, `spx-play-store`, `spx-voice-feed-store`, and
`shared-cache` mocked: (1) the off-hours closed-market shortcut fires exactly one background
`loadMergedSpxDesk()` call when the throttle lock is won; (2) it fires NONE when the throttle lock
is already held (simulating another replica/recent poll within the refresh window) — proving the
throttle, not just the refresh, actually works. Confirmed RED pre-fix (`git stash` of the two
source files, both tests failed asserting the throttle lock was never even attempted) and GREEN
post-fix.

Ran on Node 20 (`export PATH=/opt/node20/bin:$PATH`):
- `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-service-merged-desk-bg-refresh.test.ts` — 2/2 pass.
- Full `src/features/spx/` test tree (143 files): 923/923 pass, 0 fail.
- Full repo suite via `node scripts/run-tests.mjs`: 17049/17049 pass (3 pre-existing, unrelated skips), 0 fail.
- `npx tsc --noEmit` — clean.
