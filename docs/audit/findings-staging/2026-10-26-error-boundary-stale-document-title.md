> **kind:** FINDING

## `error.tsx` never updates the tab title to reflect the error state — FIXED

**Status:** FIXED — PR #TBD, merged pending CI.

### Root cause

`src/app/error.tsx` is a required client component (`"use client"`) — Next.js App Router
mandates error boundaries be client components, so unlike `not-found.tsx` (a server component
that exports a static `metadata` object with its own title) `error.tsx` has no way to declare a
title for the error state. The shared `RouteErrorBoundary` component it renders
(`src/components/route-error-boundary.tsx`) never set `document.title` either, so when a route
segment crashes, the browser tab keeps whatever title the page had a moment before the crash
(or, on an initial-load crash, the root layout's default homepage title) — never anything that
tells the viewer, at a glance from the tab bar, that the page is in an error state.

### Evidence

Read `src/app/not-found.tsx` (has `metadata.title = "Page not found — BlackOut"` plus explicit
`robots: { index: false }`) and compared against `src/app/error.tsx` (`export { default } from
"@/components/route-error-boundary"` — a bare re-export, no metadata of any kind) and
`route-error-boundary.tsx` itself (no `document.title` write anywhere in the file before this
fix).

### Blast radius

Every route segment in the app uses this one shared error boundary (`error.tsx` at the app root,
re-exporting the same component) — a single fix covers the whole site.

### Fix

Added `setErrorPageTitle(doc = document)` (exported, with an injectable `doc` param so the logic
is directly testable without React Testing Library, which this repo doesn't carry) that sets
`document.title = ERROR_PAGE_TITLE` ("Something went wrong — BlackOut"), called from the existing
`useEffect` in `RouteErrorBoundary` alongside its existing `console.error`/chunk-reload logic.
RED→GREEN proven via a temp-file swap of the pre-fix source (not `git stash`, per this session's
standing avoidance of stash on the shared sandbox working directory): 2/2 new tests fail against
the original file, 2/2 pass against the fix. Lint and `tsc --noEmit` clean.

### Why this fix and not an alternative

A full per-error-type title (e.g. distinguishing a 500 from a chunk-load error) was considered
and rejected as over-scoped for what is, in every case, the same generic "something broke, try
again or go home" UI the component already renders — one title matching the one UI is
proportionate. `not-found.tsx`'s `robots: { index: false }` pattern doesn't apply here since a
runtime error boundary has no stable URL of its own to index in the first place (it renders in
place of whatever route actually crashed).
