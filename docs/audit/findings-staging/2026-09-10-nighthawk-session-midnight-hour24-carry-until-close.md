# ICU midnight-as-"24" quirk broke `isBeforeOrAtMarketCloseEt`, mislabeling every fresh Night Hawk edition STALE for the first hour after midnight ET — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-nighthawk-session-midnight-hour24 |
| **Pri** | P2 |
| **Area** | Night Hawk (Legacy + 0DTE) / shared ET session-timing helper |
| **Status** | FIXED |

## Symptom

Live repro, `GET /api/market/nighthawk/edition` (2026-09-10T04:06 UTC = 2026-09-10T00:06 ET,
via `scripts/audit/lib/audit-auth-fetch.mjs`, temp Clerk premium session): the response carried
`available: true`, `edition_for: "2026-09-10"`, `served_for: "2026-09-10"`, `published_at:
"2026-09-09T21:34:32.000Z"` (tonight's edition, published ~5:34pm ET the evening before, 3 real
plays) — yet also `stale: true`, `carry_until_close: false`. `PlaybookBoard.tsx` renders `stale`
as a gold banner: *"Showing Sep 10 edition — tonight's playbook isn't published yet. Levels may
no longer be current."* That claim is false: the edition being shown IS tonight's edition, IS
published, and IS current — a member opening Night Hawk in the six minutes after midnight ET
sees a false "not published yet, may be stale" warning over the freshest possible content, and
loses the `FreshnessChip`/LIVE badge that `showFreshBadge = hasPlays && !isStale && !isDegraded`
would otherwise show.

## Root cause

`resolveNighthawkEdition` (`edition/route.ts`) has a branch specifically for this: when
`fetchLatestPlayableNighthawkEdition()`'s `edition_for` differs from the freshly-computed
`editionFor = nextTradingDayEt(todayEt())` (true every night after midnight ET, since
`nextTradingDayEt` always looks strictly past "today"), it should still serve the latest edition
as `carry_until_close: true` — *not* fall through to the `stale` fallback — as long as
`isBeforeOrAtMarketCloseEt(activePlayable.edition_for)` is true for the target session. That
function (`session.ts`) reads the ET hour via `Intl.DateTimeFormat({ hour12: false })` and computes
`mins = hour * 60 + minute`, returning `mins <= 16 * 60` (4pm ET). But `hour12: false` renders ET
**midnight as `"24"`, not `"00"`**, in this Node/ICU build (confirmed directly:
`new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute:
"numeric", hour12: false }).formatToParts(new Date())` → `{hour: "24", minute: "09"}` when the
real ET wall-clock time was 00:09). Unnormalised, `mins` computes to 1440-1499 for the entire
00:00-00:59 ET window — comfortably past the 16:00 cutoff — so `isBeforeOrAtMarketCloseEt`
incorrectly returns `false` for a session that is in fact only minutes old. The `carry_until_close`
branch's condition fails, and the route falls through to the `latest`-edition path, which sets
`stale = true` unconditionally whenever `edition.edition_for !== editionFor` (true here, since
`editionFor` itself is one day ahead due to the same `nextTradingDayEt` semantics).

This exact ICU quirk was already found and fixed twice elsewhere in this codebase
(`src/lib/et-session-facts.ts`, `src/lib/public-gex-snapshot.ts` — both carry an explicit "`hour12:
false` renders midnight as `24`" normalisation comment) but `session.ts`'s two independent
`Intl.DateTimeFormat` call sites — `etNowParts()` and `isBeforeOrAtMarketCloseEt()` — never got
the same treatment. `etNowParts()` is the more widely used of the two (17+ call sites across
`zerodte/scan.ts`, `platform/zerodte-service.ts`, `zerodte/live-marks.ts`,
`zerodte/session-phase.ts`, several Night Hawk command-deck components), so every `hour*60+minute`
comparison built on it was silently wrong for the same 00:00-00:59 ET window every trading day.

## Blast radius

Fixed both `Intl.DateTimeFormat` call sites in `session.ts` (`etNowParts` and
`isBeforeOrAtMarketCloseEt`) since they share the identical root cause and file. Did **not** touch
the ~40 other `hour12: false` sites found repo-wide (`grep -rn "hour12: false" src/`) — most format
for display only (a cosmetic `24:07` render, not an arithmetic comparison) and are out of scope for
this fix; flagging here as a candidate for a follow-up sweep specifically for call sites that do
`Number(hour) * 60 + minute`-style arithmetic on an unnormalised hour, the pattern that actually
breaks.

Confirmed both consumers of `etNowParts`'s `hour` were affected in principle; `isMarketClosed()`
(`day-trade-agent.ts`, delegates to `isBeforeOrAtMarketCloseEt`) is masked in practice for its own
purpose — midnight ET genuinely IS "market closed," so the wrong reasoning path there still landed
on the right answer by coincidence. The Night Hawk edition route's `carry_until_close` branch is the
one place this repo already confirmed live-broken by the wrong reasoning path landing on the WRONG
answer.

## Fix

Normalise `rawHour === 24 ? 0 : rawHour` at both call sites in `session.ts`, matching the existing
pattern in `et-session-facts.ts`. No behavior change outside the 00:00-00:59 ET window.

## Evidence

- Live envelope capture above (2026-09-10T04:06 UTC, temp Clerk premium session via
  `scripts/audit/lib/audit-auth-fetch.mjs`).
- Direct reproduction of the ICU quirk: `node -e 'console.log(new Intl.DateTimeFormat("en-US",
  {timeZone:"America/New_York",hour:"numeric",minute:"numeric",hour12:false}).formatToParts(new
  Date()))'` at 2026-09-10T04:09 UTC → `{hour:"24", minute:"09"}`.
- RED→GREEN, Node 20 (`/opt/node20/bin`): new test
  `isBeforeOrAtMarketCloseEt is true in the first minute after midnight ET (ICU hour24 quirk)` in
  `src/features/nighthawk/lib/session.test.ts` — `false !== true` before the fix, `39/39 pass`
  after (`node --import tsx --experimental-test-module-mocks --test
  src/features/nighthawk/lib/agents/day-trade-agent.test.ts
  src/features/nighthawk/lib/session.test.ts src/app/api/market/nighthawk/edition/route.test.ts
  src/features/nighthawk/lib/session-edition-target.test.ts`).
- Direct re-check of the live helper post-fix at the real current time (2026-09-10T04:11 UTC =
  00:11 ET): `isBeforeOrAtMarketCloseEt(todayEt())` now returns `true` (was `false` pre-fix).
- `npx tsc --noEmit -p .`: clean.
- Full `npm test` (Node 20): see PR for the run's tail — no new failures beyond this repo's
  documented pre-existing baseline.
