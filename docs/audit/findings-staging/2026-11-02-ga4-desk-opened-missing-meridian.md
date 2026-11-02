> **kind:** FINDING

## GA4 `desk_opened` funnel event never fires for the Meridian desk — `DESK_PATH_PREFIXES` was stuck at 6 of 7 systems — FIXED

**Status:** FIXED (`fix/ga4-desk-opened-missing-meridian`)

### Root cause

`src/lib/analytics/ga4-events.ts`'s `DESK_PATH_PREFIXES` — the list `isDeskPath()` checks a
pathname against to decide whether to fire the `desk_opened` GA4 funnel event (wired in
`Ga4Attribution.tsx`: "first authenticated visit fires desk_opened once per session") — listed
only 6 routes:

```ts
export const DESK_PATH_PREFIXES = [
  "/dashboard", "/flows", "/heatmap", "/nighthawk", "/terminal", "/vector",
] as const;
```

`/meridian` was missing. `git log` shows exactly why: this file was written in PR #1533
(2026-ish, GA4 attribution loop launch) — **before the Meridian desk existed at all**. Meridian
shipped later in PR #2250/#2251 ("Phase 0 catalyst structure desk") and was added to every OTHER
canonical desk-route list in the codebase at that time or since:

- `DESK_NAV_LINKS` (`src/lib/desk-nav-links.ts`) — the single 7-desk source Nav.tsx and
  DeskSidebar.tsx both import from (unified in PR #4385 specifically to stop them drifting from
  each other) — includes `/meridian` as the 7th entry.
- `IOS_TOOL_ROUTES` and `IOS_NATIVE_SHELL_PATH_PREFIXES` (`src/lib/ios-tool-routes.ts`) both
  include `/meridian`.

`ga4-events.ts`'s `DESK_PATH_PREFIXES` was the one list nobody updated. Since `isDeskPath()` uses
an exact-match-or-prefix check (`pathname === p || pathname.startsWith(\`${p}/\`)`), a pathname of
`/meridian` or `/meridian/<anything>` matched none of the 6 entries and `isDeskPath("/meridian")`
silently returned `false` — no error, no warning, just a desk that structurally cannot fire its
own "first open this session" conversion-funnel event.

### Evidence

- `git log --oneline -- src/lib/analytics/ga4-events.ts` shows only two commits, both predating
  Meridian: `ba6a313b4` (GA4 attribution loop launch, PR #1533) and `9091e18e9` (A/B experiments
  layer, unrelated). Meridian's own first commit (`c06871e5e`, "feat(meridian): Phase 0 catalyst
  structure desk") landed after both, and never touched this file.
- `src/app/(site)/meridian` is a real, live product desk route (confirmed present on disk,
  paywalled/tiered like the other six — `src/features/meridian/**`), not a marketing page.
- Reading the only real caller, `Ga4Attribution.tsx`: `if (isDeskPath(pathname) &&
  hasSessionCookie() && ga4OncePerSession("desk_opened")) trackGa4Event(GA4_EVENTS.deskOpened,
  {page_path: pathname})` — Meridian visits skip this branch entirely, so the event is never
  queued, never sent, and never shows up in GA4's funnel reports for that desk. Every other desk
  (SPX Slayer, HELIX, Thermal, Largo, Night Hawk, Vector) has been reporting this event
  correctly since launch; Meridian alone has been silently excluded since its own launch.
- New regression tests (RED before the fix, GREEN after — verified both ways in this session):
  - `isDeskPath("/meridian")` and `isDeskPath("/meridian/some-event-id")` now return `true`
    (previously `false`).
  - A new drift-guard test iterates the canonical `DESK_NAV_LINKS` (the same 7-desk source Nav/
    DeskSidebar already unify on) and asserts every one of its `href`s is present in
    `DESK_PATH_PREFIXES`, so a future 8th desk added to `DESK_NAV_LINKS` but forgotten here fails
    loudly instead of silently repeating this exact bug.

### Blast radius

Single call site, single consumer: `Ga4Attribution.tsx`'s `desk_opened` tracker is the only place
`isDeskPath()`/`DESK_PATH_PREFIXES` is read (confirmed via repo-wide grep). No other analytics
surface (X pixel, Google Ads, `purchase`/`begin_checkout` events) keys off this list, so the fix
is fully scoped to one missing funnel event for one desk.

### Fix rationale

Add `/meridian` as the 7th entry to `DESK_PATH_PREFIXES`, matching every sibling canonical
desk-route list in the codebase (`DESK_NAV_LINKS`, `IOS_TOOL_ROUTES`,
`IOS_NATIVE_SHELL_PATH_PREFIXES`) exactly. No behavior other than the `desk_opened` event gate
changes — `isDeskPath()`'s matching logic (exact match or `/prefix/` boundary) was already
correct and is left untouched; only the list of prefixes it checks against was incomplete.
Deliberately did not generalize `DESK_PATH_PREFIXES` to import directly from `DESK_NAV_LINKS` in
this PR (a larger refactor touching a stable, narrowly-scoped analytics module) — the added
drift-guard test gives the same future-proofing (a new desk missing from this list now fails a
test) without that larger change.

### Gates

`npx tsc --noEmit` clean · `npx eslint src/lib/analytics/ga4-events.ts
src/lib/analytics/ga4-events.test.ts` clean · targeted suite (`src/lib/analytics/*.test.ts
src/lib/desk-nav-links.test.ts`, Node 20.20.2): 49 pass / 0 fail.
