# 2026-11-09: Helix DarkPoolPanel's ticker-filtered date column rendered in the viewer's browser timezone, not ET — could show the wrong calendar date entirely

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/features/helix/components/DarkPoolPanel.tsx`'s `fmtDate()` — the formatter behind the
ticker-filtered dark-pool tape's absolute date/time column (`showDate={!!filterTicker}`) — used
`Date.prototype.getMonth()`/`getDate()`/`getHours()`/`getMinutes()`, the Date object's **local**
getters. In a browser, "local" means the viewer's own OS/browser timezone, not the US market's.
Every other absolute timestamp on this exact desk (the sibling Options Flow tape, same
`src/features/helix/` directory) is deliberately anchored to `America/New_York` via
`fmtFullTimestamp` (`helix-flow-format.ts`), whose own header states the rule explicitly: "The
options tape is an ET tape ... so we format the instant in `America/New_York` regardless of the
runtime's own zone." `fmtDate` never got the same treatment and quietly broke that desk-wide
convention.

## Root cause

`fmtDate` built its output straight from the Date object's local-timezone accessors:

```ts
const mo = String(d.getMonth() + 1).padStart(2, "0");
const dy = String(d.getDate()).padStart(2, "0");
const hr = String(d.getHours()).padStart(2, "0");
const mn = String(d.getMinutes()).padStart(2, "0");
```

These read the instant through whatever timezone the browser's JS engine is configured for — the
member's own device, not `America/New_York`. Because ET trails UTC by 4-5 hours while most
non-US timezones run *ahead* of UTC, a print near the 16:00 ET close (~20:00-21:00 UTC) would
frequently land on the *next calendar day* for a member in Europe, Asia, or Australia — not merely
show a different clock hour, but a different date entirely, directly contradicting the ET
timestamps shown on the rest of the same desk for the exact same instant. The sandbox/CI
environment's own default TZ is UTC (`Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC"`),
so the defect was directly reproducible here too, not merely theoretical for non-US members.

Why it wasn't caught by the existing "stop fabricating dark-pool timestamps" fix (#2755) or the
bias-badge fixes (#2739/#4069) in this same file's history: those addressed *absence* and
*population-mismatch* bugs in different helpers (`timeAgo`, `readDarkPoolBias`); none of them
touched `fmtDate`'s own timezone anchoring, and `git log -- DarkPoolPanel.tsx` confirms no commit
ever did.

## Evidence (RED → GREEN)

Picked a timestamp that crosses the UTC/ET calendar-date boundary, so a host-timezone read and an
ET-anchored read disagree on the **date**, not just the hour:
`2026-01-16T03:15:00.000Z` is `03:15` on Jan 16 in UTC, but `22:15` on **Jan 15** ET (EST,
UTC-5 in January).

RED (pre-fix, via `git stash` isolating only the source change, keeping the new test): the new
test file fails — `fmtDate` was not even exported yet (`is not a function`), 3/5 tests in
`DarkPoolPanel.test.tsx` fail.

GREEN (post-fix):
```
npx tsx --experimental-test-module-mocks --test \
  src/features/helix/components/DarkPoolPanel.test.tsx \
  src/features/helix/components/DarkPoolPanel.test.ts
# tests 7, pass 7, fail 0
```
`npx tsc --noEmit` clean. `npx eslint` on both touched files: clean.

## Fix

Rewrote `fmtDate` to build the `MM/DD HH:MM` string from `Intl.DateTimeFormat("en-US", {
timeZone: "America/New_York", ... hour12: false }).formatToParts(d)`, the same approach and
hourCycle-"24"-at-midnight normalization guard `fmtFullTimestamp` already carries — so the two
absolute-timestamp columns on this desk (Flow tape, Dark Pool tape) now agree with each other and
with the ET session the data actually describes, regardless of the viewer's own timezone. The
compact `MM/DD HH:MM` (no year) format is kept as-is — the column is a narrow 72px and the year
was never shown before this fix either; only the timezone anchoring changed. `fmtDate` is now
exported (previously module-private) so it can be unit-tested directly, matching the existing
`fmtShares` export in this same file.

## Blast radius

One function, one file, one render path (the ticker-filtered dark-pool tape's date column — the
unfiltered view uses `timeAgo`, which is relative and timezone-agnostic, so it was never affected).
Grepped the rest of the repo for the same local-getter date-formatting shape
(`d.getMonth()`/`.getHours()).padStart`/`getDate()).padStart`) and found two other matches —
`src/app/api/cron/x-intel/x-intel-time.ts` and `src/lib/x-intel/queue-store.ts` — both server-side
(`"server-only"` import / cron route, no `"use client"`), operating on an already ET-shifted Date
value for marketing/X-autopost scheduling logic, not a browser-rendered member-facing timestamp.
Confirmed these are a different risk shape (server business logic, not viewer-timezone-dependent
display) and out of this fix's scope; `DarkPoolPanel.tsx` was the only client-rendered instance of
this specific bug.
