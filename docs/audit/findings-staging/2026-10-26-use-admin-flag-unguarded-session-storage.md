> **kind:** FINDING

## use-admin-flag.ts called `sessionStorage` directly, with no try/catch — FIXED

| **Status** | FIXED — PR follows this file in the same commit batch |

**Root cause:** `src/hooks/use-admin-flag.ts`'s `readSessionAdminFlag()` (read) and
the `useAdminFlag()` effect's `sessionStorage.setItem(...)` (write) called the global
`sessionStorage` directly, with no `try/catch`. Every other storage call site in this
repo (`vector-alerts-store.ts`, `vector-drawings-store.ts`, `thermal-saved-desks.ts`,
`meridian-desk-prefs.ts`, `chunk-load-error.ts`) wraps storage access and degrades to
a safe default on failure — `use-admin-flag.ts` was the one exception.

Storage access can throw a `SecurityError` in more cases than private-mode quota:
a sandboxed `<iframe>` embed without `allow-same-origin`, or a browser/extension that
blocks cookies/storage (Safari's "Block All Cookies", several privacy extensions).
`useAdminFlag()` backs the shared admin flag for global `Nav` and the iOS chrome, so
an uncaught throw inside its `useEffect` would propagate and risk breaking global
navigation for any affected member, instead of silently falling back to the
server-fetched admin flag the hook already has available.

**Evidence:** Reproduced with a fake `sessionStorage` whose `getItem`/`setItem` throw
`SecurityError`. Pre-fix shape: 2/4 new unit tests fail (both throwing-storage cases)
with the thrown error propagating uncaught. Post-fix shape (both calls wrapped in
try/catch, degrading to `null`/no-op): 4/4 pass. `npx eslint` and `tsc --noEmit` clean
on the changed files.

**Blast radius:** Single file, single hook, used by `Nav` and iOS chrome only — no
other call site duplicates this logic.

**Fix:** Wrapped both `sessionStorage.getItem` (read) and a newly-extracted
`writeSessionAdminFlag()` helper (write) in try/catch, matching the established
degrade-to-safe-default pattern used everywhere else in this codebase for storage
access. Exported both helpers (previously unexported) so the throwing-storage path
could be unit tested directly without a full jsdom hook render.

Found during DISCOVERY-lane round 71's repo-wide localStorage/sessionStorage
try/catch audit (part of the standing autonomous bug-sweep mandate), after an earlier
round proved the sibling "unhandled fire-and-forget fetch" bug shape real
(`AuthFailureObserver.tsx`, PR #6845).
