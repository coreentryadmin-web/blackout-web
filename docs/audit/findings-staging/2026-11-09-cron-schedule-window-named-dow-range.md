> **kind:** FINDING

## `parseDow` silently drops a named weekday RANGE ("MON-FRI") — a cron schedule in that form computes zero fires forever — FIXED

| | |
|---|---|
| **Area** | `src/lib/cron-schedule-window.ts` (cron-staleness-watchdog support, `admin-cron-health.ts`) |
| **Severity** | P2 — a silent, fail-open watchdog defect (not currently exercised by any live `cron-registry.ts` row, but reachable by its own documented input shape and by any future entry copied from the EventBridge comment style already used elsewhere in this codebase) |
| **Status** | FIXED |

### Root cause

`parseDow(field)` parses a cron day-of-week field into a `Set<number>` of
allowed weekdays (0=Sun..6=Sat). It has three branches, tried in order:

1. a numeric range (`/^(\d+)-(\d+)$/`, e.g. `"1-5"`)
2. a single named day (`DOW_NAMES[part.toUpperCase()]`, e.g. `"MON"`)
3. fallback: `Number(part) % 7`

A **named weekday range** — `"MON-FRI"`, `"SAT-SUN"`, etc. — matches none of
these: it isn't all-digits (branch 1 fails), it isn't a single 3-letter name
(`DOW_NAMES["MON-FRI"]` is `undefined`, branch 2 fails), so it falls to
branch 3: `Number("MON-FRI")` is `NaN`, and `out.add(NaN % 7)` adds `NaN` to
the set. `Set.has(dow)` then never matches any real day (0-6), so
`enumerateFiresOnUtcDay` returns `[]` for **every** day, forever.

That is not a loud failure. `lastExpectedCronFireUtc`/`nextExpectedCronFireUtc`
both return `null` with no throw, no warning, nothing. Worse, the caller,
`isInOffScheduleIdleGap`, treats "no fires found" as `return true` (its
`if (!bounds) return true` branch) — i.e. it reports the job as *permanently,
correctly, off-schedule-idle*. In `admin-cron-health.ts` that status
suppresses the staleness alarm outright (`notDueYet` / `suppressStaleOffSchedule`
→ `status: "unknown"`/`"healthy"`), which is the exact 180°-wrong outcome for
a watchdog: a cron that is actually stuck on a `"MON-FRI"`-style schedule
would never be flagged, read as "nothing to see here" instead of an error.

### Why this wasn't caught sooner / evidence it's real, not theoretical

Every `schedule_cron_utc` row currently in `src/lib/cron-registry.ts` happens
to spell its weekday field numerically (`"1-5"`), so this exact path is not
hit by any live registry entry today — confirmed by grepping the file (every
occurrence is `* * 1-5`). But the named-range textual form is not invented
for this finding:

- `isDualBandMorningUtcSchedule` (a few lines below `parseDow` in this same
  file) already special-cases it explicitly: `dowField.toUpperCase() ===
  "MON-FRI"` — proving the author expected this exact string could reach the
  parser.
- Several real AWS EventBridge schedules are documented in this codebase's
  own route comments in precisely this form —
  `src/app/api/cron/heatmap-warm/route.ts` (`cron(*/1 11-21 ? * MON-FRI *)`),
  `src/app/api/cron/uw-cache-refresh/route.ts` (`cron(*/2 11-21 ? * MON-FRI
  *)`), `src/app/api/cron/bie-full-state-snapshot/route.test.ts`
  (`cron(*/5 11-21 ? * MON-FRI *)`) — so `"MON-FRI"` is the live syntax these
  jobs actually run under in AWS; it just happens that nobody has yet copied
  that exact string into this file's own `schedule_cron_utc` mirror field
  (which is free-text and unvalidated against the real EventBridge rule — see
  `scripts/audit/cron-dst-audit.mjs`'s own documented drift risk between the
  two).

Reproduced live before fixing (`node --import tsx`, pure function call, no
network): for the numeric form `"0 9 * * 1-5"` at a real Wednesday,
`lastExpectedCronFireUtc` correctly returns that morning's 09:00 UTC fire;
for the byte-identical schedule spelled `"0 9 * * MON-FRI"`, it returned
`null` — same inputs, same intended schedule, silently wrong answer.

### Fix

Added a named-range branch to `parseDow`, matching `/^([A-Za-z]{3})-([A-Za-z]{3})$/`
and resolving both ends through the existing `DOW_NAMES` map before building
the range — same non-wrapping semantics the pre-existing numeric range branch
already has (a start-after-end range like `"SAT-SUN"` is intentionally left
unsupported, matching that existing limitation rather than inventing new
wrap-around behavior nothing in this file has ever needed). No other branch,
caller, or threshold changed.

### Blast radius

`parseDow` is private to `cron-schedule-window.ts`, but every exported
function in the file routes through it: `lastExpectedCronFireUtc`,
`nextExpectedCronFireUtc`, `isInOffScheduleIdleGap`, and (via those)
`isAwaitingSecondaryUtcBandFire`'s sibling checks. The only current caller
tree is `src/lib/admin-cron-health.ts`'s cron-staleness watchdog — all fixed
by the one change, nothing else references `schedule_cron_utc` day-of-week
parsing independently.

### Evidence (RED → GREEN)

Added two regression tests to `src/lib/cron-schedule-window.test.ts`:
- `"named weekday range (MON-FRI) parses the same fires as the numeric range
  (1-5)"` — asserts `"0 9 * * MON-FRI"` and `"0 9 * * 1-5"` agree on both
  `lastExpectedCronFireUtc` and `nextExpectedCronFireUtc` for a real
  Wednesday.
- `"named weekday range (TUE-THU) is honored, not silently dropped"`.

Both fail against the pre-fix source (`git show origin/main:...` reverted
locally, tests re-run: 2/21 fail, `undefined` vs the expected ISO timestamp)
and pass against the fix (21/21). `npx tsc --noEmit` clean.
