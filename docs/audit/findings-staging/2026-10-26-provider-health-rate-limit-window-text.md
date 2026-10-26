> **kind:** `FINDING`

## `buildProviderHealthIssues` hardcoded "in the last hour" in the rate-limit incident detail, regardless of the actual reconcile window — FIXED

| | |
|---|---|
| **Severity** | P3 (admin-facing data-accuracy defect — misleads severity judgment on a persisted, dashboard-visible incident record; no member-facing impact, no gate/alerting threshold miscounted) |
| **Surface** | `src/lib/provider-health-issues.ts` — `buildProviderHealthIssues()`'s rate-limit issue branch, consumed by the `provider-health-reconcile` cron (`src/app/api/cron/provider-health-reconcile/route.ts`) and persisted into `admin_incidents.detail` via `syncAdminIncidents` (`src/lib/admin-incidents.ts`), surfaced on the admin operations dashboard |
| **Status** | FIXED |

### Root cause

`provider-health-reconcile`'s cron route reads a configurable window
(`PROVIDER_HEALTH_WINDOW_MIN`, default `10` minutes) and passes it through
`runProviderHealthReconcile(windowMinutes)` → `fetchProviderTelemetryRollups(windowMinutes)`, which
clamps it to `[1, 60]` and uses the clamped value in the live SQL predicate
(`WHERE at > NOW() - (N || ' minutes')::interval`). That clamped value was never threaded through
to `buildProviderHealthIssues`, which built the rate-limit issue's `detail` text with a literal,
unconditional string:

```ts
detail: `${row.rate_limits} rate-limited call(s) in the last hour`,
```

regardless of what window the rollup it was describing actually came from. With the real default
10-minute window, an admin reading "4 rate-limited calls in the last hour" on the incident
dashboard would badly understate how fast the provider is actually getting rate-limited — 4 in 10
minutes is a materially more urgent signal than 4 in 60 minutes, and this issue's own `detail` text
is the only place that context is recorded (the row is persisted verbatim into `admin_incidents`
and re-displayed from there, not re-derived). The sibling "fail" detail text had the same latent
gap in a milder form — it said generic `"... in window"` with no number at all, never claiming a
wrong duration, but also never giving the real one.

This was a clean, standalone bug — unrelated to and not a duplicate of round 126's
`admin-incidents.ts` reopen-stale-ack fix (PR #6934, still in flight): that fix is about
`acked_at`/`acked_by` not resetting on a resolved→reopened transition; this fix is about the
`detail` TEXT this cron computes before it ever reaches `syncAdminIncidents`.

### Evidence

New/extended tests in `src/lib/__tests__/provider-health-reconcile.test.ts`:
- `"reflects the ACTUAL reconcile window in the rate-limit detail text, not a hardcoded hour"` —
  passes `windowMinutes=10` and asserts the detail does NOT match `/last hour/i` and DOES match
  `/10m window/`.
- `"reflects a non-default window (e.g. PROVIDER_HEALTH_WINDOW_MIN=45) exactly, not the old
  10-minute default"` — passes `windowMinutes=45`, asserts the detail says `45m window` and not
  `10m window`.
- `"defaults to a 10-minute window label when no windowMinutes is passed (back-compat)"`.
- `clampProviderHealthWindowMinutes`: direct unit coverage of the clamp (`[1, 60]`, rounds),
  proving it matches the SQL query's own clamp byte-for-byte (it's now the literal same function).

RED→GREEN confirmed via `git stash` on just the two fixed source files (the test file itself was
not stashed, so it ran against the pre-fix implementation):
- **Before the fix:** 4/8 tests in the file failed — the two new window-text assertions (detail
  still said "last hour" / "10m window" was absent), the back-compat default assertion, and the new
  `clampProviderHealthWindowMinutes` test (`is not a function`, since the export didn't exist yet).
- **After the fix (`git stash pop`):** 8/8 pass.

Also ran the sibling `admin-incidents.test.ts` (17/17 pass, unaffected — confirms this fix doesn't
touch or interact with round 126's in-flight reopen-stale-ack fix) and a repo-wide
`npx tsc --noEmit` (clean) + `npx eslint` on both changed source files and the test file (clean).

### Blast radius

`buildProviderHealthIssues` has exactly one call site repo-wide
(`runProviderHealthReconcile` in `provider-health-reconcile.ts`, itself called only by the
`provider-health-reconcile` cron route) — verified by grep. `fetchProviderTelemetryRollups`'s own
clamp logic was extracted into the newly-exported `clampProviderHealthWindowMinutes` so the query
and the issue text can never drift onto two different clamped values again; `fetchProviderTelemetryRollups`
now calls the shared helper instead of inlining the same `Math.min(Math.max(...))` expression a
second time. No other consumer of either function exists.

### Fix

1. Extracted the window clamp (`Math.min(Math.max(1, Math.round(minutes)), 60)`) out of
   `fetchProviderTelemetryRollups` into an exported `clampProviderHealthWindowMinutes()` in
   `provider-health-issues.ts`.
2. `buildProviderHealthIssues(rollups, thresholds, windowMinutes = 10)` gained a third, optional
   parameter (appended, not inserted — keeps every existing positional call site, including both
   existing tests, working unchanged) and now builds both the "fail" and "rate-limit" detail
   strings from a single `windowLabel = "the last ${windowMinutes}m window"`, replacing both the
   generic "in window" phrasing and the hardcoded "in the last hour" string.
3. `runProviderHealthReconcile` now computes `clampProviderHealthWindowMinutes(windowMinutes)`
   once and passes that SAME value into `buildProviderHealthIssues`, so the issue text always
   describes the exact window the SQL query actually used — including when an env override like
   `PROVIDER_HEALTH_WINDOW_MIN=120` gets clamped down to 60 before the query runs; the old code
   would have had no way to reflect that clamp in text at all, since it never threaded the window
   through in the first place.

### Fix rationale

Threading the already-clamped number through (rather than, say, re-deriving or re-clamping a raw
value inside `buildProviderHealthIssues` itself) keeps the query and the display text
provably in sync — they now both call the one exported `clampProviderHealthWindowMinutes`, so a
future change to the clamp bounds only has one place to change. Appending `windowMinutes` as a
third parameter with a default (rather than, say, folding it into `ProviderHealthThresholds`) was
deliberate: it's not a tunable severity threshold, it's provenance about the data being described,
and keeping it separate avoids touching the thresholds type/tests at all.

### Tests

`src/lib/__tests__/provider-health-reconcile.test.ts` (4 new tests + existing 4 unchanged, all 8
pass). `src/lib/admin-incidents.test.ts` (17/17, unaffected). `npx tsc --noEmit` clean repo-wide.
`npx eslint` clean on all three touched files.
