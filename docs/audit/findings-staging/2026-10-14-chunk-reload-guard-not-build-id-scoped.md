> **kind:** FINDING

## React error-boundary ChunkLoadError self-heal never resets — a session surviving one deploy-skew reload could never self-heal a second, unrelated one — FIXED

| | |
|---|---|
| **Component** | `src/lib/chunk-load-error.ts` (`autoReloadOnceOnChunkError`), `src/app/global-error.tsx` (its own inlined copy), consumed by `src/components/route-error-boundary.tsx` |
| **Status** | FIXED — this PR |

**What prompted this.** Investigating what actually happens on a client-side Next.js (App Router,
`next@15.5.25`) navigation when a browser tab that loaded its HTML from one ECS deploy clicks to a
route whose JS chunk only exists in a *later* deploy — the classic "session opened before
deployment, does navigating between desks still work afterward" scenario.

**Two layers already handle most of this correctly, confirmed by reading Next's own compiled
source, not guessed:**
1. **Next's own client router already self-heals the RSC-data half of this, with no custom code
   needed.** `node_modules/next/dist/client/components/router-reducer/fetch-server-response.js`
   compares the just-fetched flight response's own build id (`response.b`) against the tab's
   build id (`getAppBuildId()`, captured once at initial load) on **every** client-side
   navigation; a mismatch — or a non-RSC/non-200 response — returns `doMpaNavigation(...)`, and
   `app-router.js`'s `pushRef.mpaNavigation` branch does a real `window.location.assign/replace`
   (a full browser reload), independent of any error boundary in this repo.
   `node_modules/next/dist/client/app-build-id.js`'s own header comment states the intent
   verbatim: "if the incoming data has a different build ID, we perform an MPA
   navigation/refresh." **This answers computed-task question 1 directly: yes, Next's client
   router has a built-in automatic MPA fallback for a failed/stale navigation fetch, independent
   of any app-level error-boundary code.**
2. **Every lazy desk panel in this repo (`next/dynamic`, `src/features/{helix,nighthawk,
   vector,thermal,spx}/.../*PageShell.tsx` and siblings — 20 call sites, `grep -rn "next/dynamic"
   src/features src/components`) is declared at module scope and rendered inline in JSX**, never
   invoked from inside a raw `import()` in an event handler or effect (repo-wide grep for
   `await import(`/`= import(`/`` import(` `` under `src/` found none in a client `.tsx` outside
   one server-only OG-image route). `next/dynamic` wraps its loader in `React.lazy`
   (`node_modules/next/dist/shared/lib/lazy-dynamic/loadable.js`), and a rejected `React.lazy`
   promise is a documented React render-phase throw, caught by the nearest **error boundary**
   regardless of whether a `Suspense` boundary also wraps it — so in THIS codebase, as currently
   written, a failed lazy chunk for a desk panel is guaranteed to reach `RouteErrorBoundary`/
   `global-error.tsx`, never silently becoming an invisible `unhandledrejection`. **This answers
   computed-task question 2 for the code as it exists today**: the theoretical "error boundaries
   can't see an async-callback rejection" gap genuinely exists in React in general, but nothing in
   this repo currently exercises it.

**The actual, confirmed bug: the error-boundary layer's own self-heal never resets.**
`src/lib/chunk-load-error.ts`'s `autoReloadOnceOnChunkError` (added 2026-08-24, PR #2842) sets a
bare `sessionStorage` flag (`bo-chunk-error-reload-attempted`) the first time it reloads for a
`ChunkLoadError`, and **nothing anywhere ever clears it.** `global-error.tsx` inlines an identical,
independent copy of the same bug (its own "no imports beyond react" rule means it can't share the
logic). This predates the fix by over a month: `src/lib/chunk-reload.ts` (the OLDER, canonical
mechanism wired into `app/layout.tsx`'s inline `<head>` script, shipped 2026-07-17, run #770) has
always done this correctly — it reads the tab's live build id off its own `<script
src="/_next/static/<id>/...">` tag and **resets its retry counter whenever that id changes**,
specifically so a member can self-heal through more than one independent incident in the same tab.
The 2026-08-24 PR added a second, narrower, non-build-id-aware mechanism for the exact same class
of failure without reconciling it against the existing one, and `chunk-reload.test.ts`'s own
"kept in sync" parity test only covers the inline script, not this file — so the two were free to
drift, and did.

**Concrete failure this caused:** a tab self-heals from its FIRST `ChunkLoadError` (e.g. Desk A's
lazy panel, caught by `RouteErrorBoundary`, one reload fires, flag set). Later in the SAME tab —
navigating to a different, not-yet-visited desk, whether still mid the same rollout or across a
genuinely later, separate deploy (this repo's own fast merge-queue cadence, documented elsewhere in
`CLAUDE.md`, makes a second rollout within one browsing session plausible, not a remote edge case)
— that desk's own first-time lazy chunk load fails too. `autoReloadOnceOnChunkError` sees the flag
already set and **does nothing**: no reload, member stuck on the manual "Try again" screen for an
incident the mechanism's own design intent says should have self-healed, exactly the failure mode
the canonical `chunk-reload.ts` guard was built a month earlier to prevent.

**Fix.** Scoped the guard to the build id it last fired for, in both copies:
- `chunk-load-error.ts`: new `currentBuildId(win)` reads the live page's own `/_next/static/<id>/`
  script src (same signal `chunk-reload.ts` uses), via the already-injectable `win` parameter
  (extended with an optional `document`); the stored guard value is now that build id (or `"1"`
  when no id signal is available, preserving the pre-fix "once ever" fallback for a test
  environment or an unexpected page shape — never worse than before this fix). A reload is skipped
  only when the stored value matches the CURRENT build id; a different (newer) build id gets a
  fresh one-shot attempt.
- `global-error.tsx`: identical logic, inlined (no import — same `isChunkLoadError` constraint as
  before).
- Both `isChunkLoadError` implementations were also widened from the bare `ChunkLoadError`/"Loading
  chunk N failed" subset to the full canonical `CHUNK_ERROR_PATTERN_SOURCE` set (`chunk-reload.ts`:
  CSS-chunk 404s, a failed dynamic `import()`, a MIME-refused script/style, a stale Server Action
  id) — a rejected `next/dynamic` loader is exactly the kind of failure that can reach ONLY a React
  error boundary (never the inline script's `unhandledrejection`/resource-error listeners, since
  React consumes that promise internally), so under-matching here meant some of these genuinely
  never got a self-heal attempt through this layer, not just a slower one.

**Evidence.** `src/lib/chunk-load-error.test.ts`: new tests prove the exact RED→GREEN —
`git stash` on `chunk-load-error.ts` alone: 2 of the (now 15) tests fail pre-fix (the widened-
pattern match, and the multi-incident self-heal across two different build ids), 15/15 pass
restored. The multi-incident test reproduces the scenario literally: incident #1 on `build-A`
reloads, incident #2 on `build-B` (a different, later build) ALSO reloads, a repeat of incident #2
on the SAME `build-B` still does NOT reload (infinite-loop protection preserved). A dedicated
`global-error.tsx` source-text test confirms the duplicate inline copy picked up the same fix
(`currentBuildId`, the same `stored && (!buildId || stored === buildId)` guard condition).
`npx tsc --noEmit` and `npx eslint` both clean on all three touched files. Full `npm test` run
separately to confirm no unrelated regression.

**Blast radius.** `RouteErrorBoundary` (`src/components/route-error-boundary.tsx`, used by every
`app/error.tsx` and `app/(site)/error.tsx` segment — i.e. every desk/marketing route) picks up the
fix automatically via its existing `autoReloadOnceOnChunkError` import; `global-error.tsx` (root
layout crash, the most severe case since it takes down the whole app shell) was fixed in step with
it since it can't share the import. `src/lib/chunk-reload.ts`/`app/layout.tsx`'s own inline-script
mechanism (the canonical, already-correct one) is untouched — this fix brings the error-boundary
layer up to the same standard, not a change to the canonical one.

**What was deliberately left unchanged.** Did not collapse the two mechanisms into one (e.g. having
`RouteErrorBoundary` read/write the inline script's own `blackout:chunk-reload`/`blackout:build-id`
keys instead of its own) — they protect genuinely different failure surfaces (the inline script
reacts to `<script>`/`<link>` resource-load DOM events and generic `unhandledrejection`s, fired
before React even mounts; the error-boundary layer reacts to a React render-phase throw after a
component actually tried to use the failed module) and a deeper merge is a larger, separate
refactor than this fix's root cause warrants. Did not change the "cap at 1 reload, no backoff"
behavior of the React-boundary layer to match the inline script's "cap at 3, 8s apart" — the bug
fixed here is specifically that the guard never reset for a NEW incident, not that one attempt per
incident is too few.
