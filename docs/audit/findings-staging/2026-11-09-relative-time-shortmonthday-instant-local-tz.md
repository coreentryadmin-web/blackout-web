# 2026-11-09: shared `shortMonthDay()` rendered an ISO-instant date in the viewer's browser timezone, not ET — latent repeat of the DarkPoolPanel/SignalAnalyticsPanel bug class, in the SHARED helper this time

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/lib/relative-time.ts`'s `shortMonthDay()` is the shared, guarded "M/D" date formatter used
across the Night Hawk 0DTE board (`ZeroDteBoard.tsx`'s edition-echo date and per-play `expiry`
chip). Its own JSDoc and test file document that it accepts *either* a plain `"YYYY-MM-DD"`
calendar date *or* an ISO instant (a real timestamp with its own time/offset). The calendar-date
branch is correctly timezone-safe (anchored at local noon, then rendered in the same local zone —
self-consistent, no slip possible). The ISO-instant branch was not: it rendered
`d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" })` with no `timeZone`, so a real
instant with its own explicit offset was displayed in the **viewer's** local browser timezone
instead of the ET calendar day the product otherwise commits to everywhere else (see
`src/lib/et-clock.ts`'s header: "A markets desk quotes one clock: US/Eastern"). Same bug class
already fixed twice this session in `DarkPoolPanel.tsx` (#7824) and `SignalAnalyticsPanel` (#7826)
— this is a third instance, this time in a *shared* utility module rather than a single component,
so any future caller that passes a real ISO instant (not just the current YYYY-MM-DD callers)
would inherit the bug silently.

## Root cause

```ts
const d = /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T12:00:00`) : new Date(input);
if (Number.isNaN(d.getTime())) return fallback;
return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
```

The final `toLocaleDateString` call carried no `timeZone`, so for the `else` branch (a genuine ISO
instant) the rendered calendar day tracked `process.env.TZ`/the browser's configured zone, not ET.
Confirmed live in this sandbox (default TZ is UTC, so the defect wasn't visible from the sandbox's
own default run) by switching `process.env.TZ` mid-process and re-formatting the exact instant the
function's own pre-existing test already used:

```
TZ=UTC              → "2026-07-13T09:30:00-04:00" → "7/13"  (matches ET, looks correct)
TZ=Pacific/Auckland  → "2026-07-13T09:30:00-04:00" → "7/14"  (WRONG — one day ahead of the ET date)
```

A member east of ET (Auckland, Tokyo, Sydney) would see a date one calendar day *later* than the
real ET date for an evening-ET instant; a member west of ET (Hawaii) would see one day *earlier*
for an early-ET-morning instant that has already rolled to the next UTC day. Both current call
sites (`fmtEditionDate`'s `edition_for` and `row.expiry` in `ZeroDteBoard.tsx`) happen to pass only
plain `YYYY-MM-DD` values today, so the live-rendered bug surface is currently zero — but the
function's own contract (and its own pre-existing test) explicitly supports and exercises the
ISO-instant path, so the next caller to pass a real timestamp (e.g. a commit/fill instant) would
hit it with no warning, exactly the kind of latent shared-helper trap the ET-anchoring convention
exists to close off everywhere at once.

## Evidence (RED → GREEN)

Added a test that switches `process.env.TZ` to zones on both sides of ET (`Pacific/Auckland`,
`Pacific/Honolulu`) mid-process and re-asserts the ET-anchored date, restoring the original TZ in a
`finally`:

RED (pre-fix, via `git stash` isolating only the source change, keeping the new test):
```
not ok 4 - shortMonthDay anchors an ISO instant to ET, not the viewer's local zone
  Expected values to be strictly equal: '7/14' !== '7/13'
```

GREEN (post-fix):
```
npx tsx --experimental-test-module-mocks --test src/lib/relative-time.test.ts
# tests 4, pass 4, fail 0
```
`npx tsc --noEmit` clean on Node 20.

## Fix

Split the ISO-instant branch's render from the calendar-date branch's: the instant branch now pins
`timeZone: "America/New_York"` on the `toLocaleDateString` call (matching every other market-data
timestamp formatter in the product); the calendar-date (`YYYY-MM-DD`) branch is left exactly as it
was — pinning ET there would *reintroduce* a slip, since a far-ahead local-noon anchor (e.g.
`TZ=Pacific/Kiritimati`, UTC+14) can land on the prior ET calendar day when forced through the ET
zone, which is precisely what the local-noon trick was built to avoid. Verified both halves stay
correct for their own input shape; see the in-code comment added alongside the fix for the full
reasoning so a future edit doesn't accidentally unify the two branches.

## Blast radius

One function (`shortMonthDay`), one file (`src/lib/relative-time.ts`). Grepped every call site
(`ZeroDteBoard.tsx`'s two usages) — both pass plain `YYYY-MM-DD` values today, so no currently
*visible* member-facing render changes; this closes the latent gap in the shared helper itself
before a future caller (or a future `expiry`/`edition_for` payload shape change to a full
timestamp) would trip it silently. `relativeAge` in the same file was checked and is unaffected —
it already computes purely from epoch-ms deltas with no local-timezone formatting involved.
