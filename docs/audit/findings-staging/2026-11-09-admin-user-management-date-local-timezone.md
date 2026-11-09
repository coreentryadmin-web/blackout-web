# 2026-11-09: Admin Users table account dates rendered in the viewer's local timezone, not ET

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/components/admin/UserManagement.tsx`'s account-date formatter (rendering the "Created"/"Last
sign-in"/"Last active" columns of the admin Users table, both in the list rows and the user-detail
drawer) called `toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })`
with **no `timeZone` option**. `Date.prototype.toLocaleDateString` with no `timeZone` renders the
calendar date in the **host runtime's own timezone** — the admin's browser — not US/Eastern, this
product's one clock everywhere else on the platform (see `src/lib/et-clock.ts`'s own module header:
"A markets desk quotes one clock: US/Eastern... a formatter that omits `timeZone` silently renders
in the VIEWER'S timezone instead — with no error").

`createdAt`, `lastSignInAt`, and `lastActiveAt` are all absolute Clerk epoch-ms instants
(`UserRow.createdAt: number`, etc.), so any admin viewing this page from outside America/New_York
could see the WRONG CALENDAR DAY for any of these three columns whenever the instant falls near the
UTC/ET midnight boundary — e.g. a user who signed in at 2026-01-16T03:15:00Z (22:15 ET on
2026-01-15, EST) would show "Jan 16, 2026" to a UTC-timezone admin but should read "Jan 15, 2026".
Same bug shape already found and fixed on this platform's trading-desk surfaces this cycle
(`DarkPoolPanel.tsx`'s `fmtDate`, `SignalAnalyticsPanel.tsx`'s date-range label) — this is the same
lens applied to the admin Users table, an internal operator-facing surface rather than a member
desk, but the underlying defect (an absolute-instant date formatted with no explicit `timeZone`) is
identical.

## Root cause

```ts
function formatDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
```

No `timeZone` key, so V8's ICU-backed `toLocaleDateString` falls back to
`Intl.DateTimeFormat().resolvedOptions().timeZone` — the runtime's own zone (the admin's browser,
since `UserManagement.tsx` is a `"use client"` component). Five call sites read this helper across
the Users-table row renderer and the user-detail drawer, all affected identically.

## Evidence (RED → GREEN)

Extracted the formatter into a pure sibling module, `src/lib/admin-user-account-date.ts`
(`formatAdminUserDate`), because importing `UserManagement.tsx` directly for a unit test pulls in a
JSX-heavy import chain (`src/components/marks/geometry.tsx`) that throws
`ReferenceError: React is not defined` when loaded outside Next.js's own JSX runtime — the same
"extract pure logic into a side-effect-free sibling module" pattern this lane already applies to
`server-only`-tainted modules.

RED (pre-fix, via `git stash`/restore isolating only the `timeZone` option):

```
expected: 'Jan 15, 2026'
actual:   'Jan 16, 2026'
```

for `formatAdminUserDate(new Date("2026-01-16T03:15:00.000Z").getTime())`, run on this sandbox's
default UTC runtime — exactly the one-day drift the bug report above describes.

GREEN (post-fix, `timeZone: "America/New_York"` restored):

- `src/lib/admin-user-account-date.test.ts`: 2/2 pass.
- `src/components/admin/UserManagement.test.ts`: 8/8 pass (unchanged tests plus a new one guarding
  that `UserManagement.tsx` still delegates to the pure formatter rather than re-inlining its own
  `toLocaleDateString` call).
- `npx tsc --noEmit`: clean.

## Fix

Moved the formatter to `src/lib/admin-user-account-date.ts` as `formatAdminUserDate`, added the
missing `timeZone: "America/New_York"` option, and had `UserManagement.tsx` import and delegate to
it (`const formatDate = formatAdminUserDate;`) rather than keep a local, divergence-prone copy.
Pulling it into a shared pure module also makes it independently unit-testable without a render
harness, which the inlined version never was.

Did not touch the already-correct `etDateTimeShort`/`etClock` helpers in `et-clock.ts` — this
formatter needs a plain date (no time-of-day), and `et-clock.ts`'s existing exports are either
time-only (`etClock`) or date+time (`etDateTimeShort`); adding a third, differently-shaped export
there risked colliding with a concurrently open PR (#7826) that is independently adding its own
date-only helper (`etDateShort`, month+day, no year) to the same file for a different caller. Kept
this fix in its own dedicated module instead, consistent with this repo's standing
cross-PR-ordering caution about two lanes editing the same shared file at the same anchor.

## Blast radius

Five call sites, all in `UserManagement.tsx` (two in the Users-table row renderer, three in the
user-detail drawer), all reading the one private `formatDate` helper — now all fixed by the single
shared delegation. Grepped the rest of the repo for the same `toLocaleDateString(` pattern with no
`timeZone` option; the other hits are each a separate, already-triaged item (several already fixed
or in flight on other open PRs, several excluded as SEO/GEO-marketing-adjacent, one confirmed dead
code, one a date-only-string input that doesn't need zone-anchoring) — none share this bug's root
cause or call site.
