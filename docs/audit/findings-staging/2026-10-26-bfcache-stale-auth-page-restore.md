> **kind:** FINDING

## Authenticated pages could reappear from bfcache after sign-out — FIXED

| **Status** | FIXED — `src/components/BfcacheAuthGuard.tsx` wired into `AppShellProviders` |

### Root cause

Every authenticated route (`/account`, `/dashboard`, `/nighthawk`, `/vector`, `/meridian`,
`/admin`, etc.) gets `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`
from `withNoEdgeCache` in `src/middleware-clerk.ts`. That header stops an HTTP cache (CDN,
browser disk cache) from serving a stale copy, but it does **not** reliably stop the browser's
back/forward cache (bfcache): Chrome stopped excluding `Cache-Control: no-store` pages from
bfcache starting with Chrome 109 (bfcache is deliberately a separate mechanism from HTTP caching,
per Chrome's own bfcache documentation), and Firefox/Safari have long applied their own
fastback/page-cache aggressively regardless of cache headers.

A bfcache restore freezes and later replays the entire JS heap exactly as it was at the moment of
navigating away — DOM, React fiber tree, and all in-memory state, with **no** React effect
re-running and no network request. `SessionCacheGuard` (`src/components/SessionCacheGuard.tsx`)
already clears `sessionStorage` on sign-out, but only as a reaction to a *live* `isSignedIn`
state transition inside a mounted, running React tree — a bfcache restore has no such transition
to react to, since nothing re-executes.

Repo-wide grep confirmed no `pageshow`/`persisted` handling existed anywhere before this fix.

### Evidence

- `src/middleware-clerk.ts`: `isProtectedRoute` matches `/dashboard`, `/flows`, `/terminal`,
  `/heatmap`, `/nighthawk`, `/vector`, `/meridian`, `/admin`, `/account`; matched requests get
  `withNoEdgeCache(NextResponse.next())`.
- `src/middleware-shared.ts`: `withNoEdgeCache` sets only `Cache-Control`/`CDN-Cache-Control`/
  `Cloudflare-CDN-Cache-Control` headers — nothing that targets bfcache specifically (there is no
  bfcache-specific HTTP signal browsers currently honor besides avoiding `unload` listeners,
  which this app also doesn't register).
- `grep -rn "pageshow\|persisted" src/` (pre-fix): zero matches tied to the Page Visibility/
  bfcache API anywhere in non-owned or owned code.

### Blast radius

Every route inside `AppShellProviders`' `DeskShell` (i.e. every authenticated page) was exposed
to the same gap, since the guard that was missing (`SessionCacheGuard`) is itself shared across
all of them. Not route-specific.

### Fix rationale

Added `BfcacheAuthGuard` (`src/components/BfcacheAuthGuard.tsx`): a `pageshow` listener that
calls `window.location.reload()` whenever `event.persisted === true`. A reload forces a real
server round-trip, which re-runs Clerk's middleware and `auth.protect()` — the same check that
already correctly redirects a signed-out visitor away from a protected route on a normal
navigation. This is the standard, minimal fix for this exact browser behavior (reload-on-bfcache-
restore for sensitive/authenticated pages), rather than a heavier client-side re-validation
scheme. Wired into `AppShellProviders`' `DeskShell` alongside the existing `SessionCacheGuard`,
so it covers every authenticated page the same way. `shouldReloadOnBfcacheRestore` is exported
and unit-tested directly (2/2 passing) rather than requiring a full browser-level repro, which
this sandbox's live-UI tooling (`proxy-browser.cjs`) is not built to drive (it screenshots a
single navigation, not a multi-step back-button gesture).

Deliberately did **not** build a lighter-weight "just re-check `isSignedIn` and redirect"
alternative: a bfcache restore can leave arbitrary other React/SWR state (not just the auth flag)
frozen and stale, so a full reload is the only fix that is actually complete, and it is cheap —
this only fires on the rare bfcache-restore path, never on a normal page load.
