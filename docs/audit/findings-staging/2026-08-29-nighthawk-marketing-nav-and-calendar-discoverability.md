# Night Hawk desk: marketing nav bleeds into the live desk; History/calendar has zero discoverability

> **kind:** FINDING

## Symptom

User report, live on production: "UI is very bad ... I don't see a calendar icon like I wanted."
Confirmed live via `proxy-browser.cjs` (desktop 1440, real Clerk-authenticated premium session)
on `blackouttrades.com/nighthawk`:

1. The shared `Nav` header shows `Features ▾ · FAQ · Pricing · Learn · Open desk →` at the top of
   the live, signed-in trading desk — identical to what a signed-out marketing visitor sees. A
   paying member actively working their 0DTE board has zero use for FAQ/Pricing/Learn, and the
   header never visually "commits" to being the application rather than the marketing site.
2. There is no calendar icon anywhere visible on the default board view. The only calendar
   control that exists (`HistoryRangeDropdown` in `PlayHistoryTable.tsx`, a 🗓 icon + preset
   dropdown) is nested two levels deep: inside `NighthawkAnalyticsPanel`, which renders
   **collapsed by default** behind a "▸ SESSION ANALYTICS ... TAP TO EXPAND" strip that gives no
   hint History/calendar functionality lives inside it.

## Root cause

1. `src/components/Nav.tsx`'s `TOP_LINKS` (FAQ, Pricing) and the `Learn` link render
   unconditionally for every page and every auth state — there was no path- or auth-aware gate
   distinguishing "marketing visitor deciding whether to sign up" from "paying member on their
   live desk." The `Features` dropdown is legitimately useful on a desk page (it's the real
   cross-product switcher — see `FeatureCards`' "● LIVE" badge on the active product) so it was
   correctly left alone; FAQ/Pricing/Learn have no such dual purpose.
2. `NighthawkAnalyticsPanel`'s collapsed-row copy read `"Win 33.9% · -5.44% avg · tap to expand"`
   — accurate but gives no signal that History (with its date-range picker) is what's behind the
   tap. `PlayHistoryTable`'s calendar icon (🗓) only renders once the panel is expanded, so a user
   glancing at the board has no way to know it exists without already knowing to look.

## Fix

1. Added `src/lib/nav-desk-gate.ts` (`isSignedInOnDeskPage`), a small pure/unit-tested predicate:
   true only when the user is signed in AND the current path matches one of the real desk routes
   (`FEATURE_LINKS`' hrefs: `/dashboard`, `/flows`, `/heatmap`, `/terminal`, `/nighthawk`,
   `/vector`, `/meridian`). `Nav.tsx` now hides `TOP_LINKS` and `Learn` (both the desktop pill nav
   and the mobile sheet) when this is true; the `Features` dropdown, admin link, and auth/account
   controls are untouched.
2. `NighthawkAnalyticsPanel`'s collapsed-row copy now reads `"... tap for history"` and shows a
   small 🗓 hint icon next to the "Session analytics" title while collapsed, so the History
   control's existence is visible before the click, not only after.

## Blast radius

`Nav.tsx` is the shared header for every page on the site (marketing pages included) — the gate
is scoped tightly (`isSignedIn && onDeskPage`), so signed-out visitors and signed-in users on
non-desk pages (home, FAQ, pricing, account, etc.) see the header exactly as before. Verified by
reading every other consumer of `isFeatureActive`/`FEATURE_LINKS` in the file — none needed
updating. `NighthawkAnalyticsPanel`'s change is copy + a hint span only; no data or layout change.

## Fix rationale

Chose a path+auth predicate over removing the links outright so the marketing funnel is fully
intact for actual prospects — the gate only ever fires for an already-paying, already-on-the-desk
user, the exact population these links can never convert. Chose a hint-icon/copy change over
promoting the calendar control to a top-level always-visible element because the roadmap's own
tracked item ("Session Analytics collapsed to a compact button + full-width drawer/modal") is the
right vehicle for a bigger IA change to that panel — this fix is deliberately the minimal,
low-risk version that solves the immediate discoverability complaint without pre-empting that
larger redesign.

## Evidence

`npx tsc --noEmit` clean. New tests: `src/lib/nav-desk-gate.test.ts` (3/3), plus two updated/new
assertions in `NighthawkAnalyticsPanel.test.ts` (4/4, including a regression test pinning the new
hint-icon class). Full suite on Node 20: 11353/11355 pass, 0 fail (2 pre-existing skips). Root
cause confirmed via BEFORE screenshots (`proxy-browser.cjs`, desktop 1440, real Clerk session) of
current production showing both defects exactly as described.

| **Status** | FIXED |
