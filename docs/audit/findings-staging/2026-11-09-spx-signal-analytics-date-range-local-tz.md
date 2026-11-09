# 2026-11-09 — [FINDING, P3 Admin / SPX] `SignalAnalyticsPanel`'s "Date Range" label rendered the viewer's local calendar date instead of the market's ET date — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — this PR |
| **Found by** | Sweep for the "client-side local-timezone display vs. ET convention" lens (round 512's lead instance: `DarkPoolPanel.tsx`'s `fmtDate`, PR #7824), broadened past the originally-named Night Hawk Legacy components (which checked out clean) to other client components |
| **Scope** | `src/lib/et-clock.ts`, `src/features/spx/components/SignalAnalyticsPanel.tsx` |

## Summary

`SignalAnalyticsPanel.tsx` (the admin SPX dashboard's Signal Analytics panel,
`AdminSpxDashboard.tsx` → `/admin`) has two timestamp formatters sitting four lines apart:
`formatTime()`, which correctly renders a row's `observed_at` via `etClock()` (ET-anchored,
`@/lib/et-clock`), and `formatDate()`, which rendered the panel's "Date Range" header
(`data.summary.date_range.from`/`to` — real `observed_at` MIN/MAX timestamps from
`spx_signal_observations`, `src/app/api/admin/signal-analytics/route.ts`) via a bare
`new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })` with **no
`timeZone` option** — which silently renders in the *viewer's* local timezone, not the market's.

This is the exact "two clocks on one screen" bug class `src/lib/et-clock.ts`'s own module header
documents (PR #2368, 11 prior instances, all on the TIME half of a timestamp) — just on the DATE
half instead. A formatter that omits `timeZone` is invisible to anyone developing or testing in
Eastern, which is presumably why it survived here even though its sibling formatter in the same
file was already fixed for the identical class of bug on the TIME side.

## Root cause

`formatDate()` (`SignalAnalyticsPanel.tsx`, originally line 139-145):

```ts
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
```

`Date.prototype.toLocaleDateString` with no `timeZone` resolves the host's ambient zone — the
browser's, for a client component (`"use client"` at the top of this file). For a real instant
close to ET midnight (e.g. `2026-08-19T02:00:00Z`, which is 10:00 PM EDT on **Aug 18**), any
viewer whose local clock is at or ahead of UTC (roughly all of Europe, Africa, Asia, Australia —
and any US timezone during the brief window the stored instant is genuinely between US-Pacific
and UTC) sees **"Aug 19"**, one day ahead of the market's own ET session date. The existing
repo-wide regression guard for this bug class
(`src/lib/et-clock.test.ts`'s `"no surface formats a wall-clock time without pinning the
timezone"` test) does not catch it: that guard only inspects `toLocaleTimeString(`/`hour:`-bearing
`toLocaleString(` calls, i.e. the TIME half — a `toLocaleDateString` call with no `hour` field
(the DATE half) is outside what it scans for, which is exactly why this slipped through even
though the sibling TIME-side bug class in this same repo was already fixed and guarded.

## Fix

Added `etDateShort()` to `src/lib/et-clock.ts` — an ET-anchored month+day formatter (no time),
the date-only sibling of the existing `etDateTimeShort`, following the same pattern (cached
`Intl.DateTimeFormat`, pinned locale and zone, `null` on unparseable/missing input rather than a
fabricated or "Invalid Date" string). Pointed `formatDate` at it:

```ts
function formatDate(iso: string): string {
  return etDateShort(iso) ?? iso;
}
```

`grep` confirms `formatDate` has exactly one call site in this file (the "Date Range" header) —
fully contained, no other reader affected.

## Fix rationale

Reusing the already-established `@/lib/et-clock` module (rather than inlining a one-off
`timeZone: "America/New_York"` option on the existing `toLocaleDateString` call) matches the
module's own stated reason for existing: "the timezone cannot be a per-call-site option people
remember to pass. It is a property of the product." A local inline fix would have closed this one
call site without giving the next caller with the same need (a date-only, ET-anchored label) a
shared helper to reach for — the sibling `etDateTimeShort` already uses the shared-formatter-cache
+ pinned-locale pattern, so `etDateShort` follows it exactly rather than inventing a third shape.

### Deliberately left unchanged (and why)

- The existing repo-wide guard test in `et-clock.test.ts` was **not** widened to also scan for
  bare `toLocaleDateString` calls. A quick survey found several other pre-existing
  `toLocaleDateString` call sites without `timeZone` elsewhere in the repo (e.g.
  `relative-time.ts`, `play-history-date.ts`, `UserManagement.tsx`) — some already intentionally
  UTC/date-string-anchored by a different, deliberate convention (date-only `YYYY-MM-DD` values
  parsed at noon to dodge DST, not absolute-instant timestamps needing an ET anchor), some
  genuinely unreviewed. Turning the guard into a DATE-call ratchet without first auditing every
  existing hit would either force an unrelated, unreviewed batch of fixes into this PR or require
  an allowlist drafted without having traced each site — both out of scope for a single-issue PR.
  Flagging this as the next lead for a future round rather than taking it on here.
- `etClock`/`etDateTimeShort` themselves — unchanged, already correct, re-verified green in the
  same test run.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash push -- src/lib/et-clock.ts`, keeping the new test assertions in
`et-clock.test.ts`): 2/11 tests in `et-clock.test.ts` fail —
`(0 , import_et_clock.etDateShort) is not a function` (the new `etDateShort` tests; the function
doesn't exist pre-fix). The other 9 pre-existing tests, including the repo-wide TIME-formatter
guard, stay green (confirming the new tests are additive, not a change to existing behavior).

GREEN (post-fix, `git stash pop`): 11/11 in `et-clock.test.ts`, including:
- a cross-midnight-ET assertion: `etDateShort(Date.parse("2026-08-19T02:00:00Z"))` must equal
  `"Aug 18"` (the real ET calendar date) rather than `"Aug 19"` (what the old
  `toLocaleDateString`-with-no-`timeZone` code would render for any host at or ahead of UTC —
  this sandbox's own CI/test runner included) — proven "a function of the instant alone"
  regardless of host timezone, the same guarantee `etClock`'s own tests already establish for the
  TIME half;
- DST-boundary parity (`etDateShort` agrees on both an EDT and an EST instant);
- null-safety on missing/unparseable input, matching `etClock`'s existing contract.

`npx tsc --noEmit` clean (whole repo). Tests run on Node 20
(`/opt/nvm/versions/node/v20.20.2/bin`) via
`npx tsx --experimental-test-module-mocks --test src/lib/et-clock.test.ts`.
