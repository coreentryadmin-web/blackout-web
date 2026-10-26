> **kind:** `FINDING`

## AuthFailureObserver's sendBeacon-unavailable fallback leaked an unhandled promise rejection — FIXED

**Status.** FIXED (PR TBD).

### Area

`src/components/auth/AuthFailureObserver.tsx` — `reportAuthFailure()`, the best-effort telemetry
reporter that watches the prebuilt Clerk `<SignIn>`/`<SignUp>` DOM for an auth-failure error and
POSTs it to `/api/telemetry/auth-failure`. Not owned-lane (auth/telemetry, no owned-lane imports).

### Found by

DISCOVERY-lane, 2026-10-26 — fire-and-forget promise-rejection sweep, following up on a
previously-fixed, structurally similar GA4 race (unrelated root cause, same "fire-and-forget
network call" shape).

### Root cause

`reportAuthFailure` wraps its body in a `try { ... } catch { /* best-effort only */ }`. When
`navigator.sendBeacon` is unavailable, the fallback path is:

```ts
void fetch("/api/telemetry/auth-failure", { method: "POST", body, keepalive: true });
```

`fetch()` returns a Promise; the surrounding `try/catch` only catches a *synchronous* throw during
the call itself, not a rejection the returned Promise raises later (a network error, an ad-blocker
intercepting the request, `keepalive` exceeding its payload/queue limit, etc.). `void` discards the
Promise without attaching a handler, so a rejection here becomes an unhandled promise rejection —
console noise at minimum, and potential noise in any global `unhandledRejection`/crash-reporting
listener at worst, for what is supposed to be a silent, zero-impact-on-the-user telemetry call.

The two sibling fire-and-forget telemetry callers in the same codebase already guard against
exactly this: `ClientErrorReporter.tsx`'s fetch fallback chains `.catch(() => undefined)`, and
`AuthSignedInRedirect.tsx`'s `void fetch(...)` call does the same. `AuthFailureObserver.tsx` was
the one caller that diverged from its own siblings' established pattern.

### Fix

Added `.catch(() => undefined)` to the fetch fallback, matching the two sibling callers exactly.
Also exported `reportAuthFailure` (previously module-private) so it can be exercised directly in a
regression test without needing a DOM-rendering harness this repo doesn't have.

### Blast radius

Single call site (`reportAuthFailure`'s own `else` branch) — no other consumer of this function or
pattern inside this file. The two sibling files already had the fix; not touched.

### Tests

New `src/components/auth/AuthFailureObserver.test.ts`: mocks `navigator` (no `sendBeacon`) and a
rejecting `globalThis.fetch`, calls `reportAuthFailure`, and asserts no `unhandledRejection` fires
on the process after the microtask queue drains. RED→GREEN confirmed via the pre-fix source (fails
both because `reportAuthFailure` wasn't exported yet, and because the real rejection would leak)
vs. the post-fix source (passes cleanly). Full sibling suite
(`auth-failure-detect.test.ts` + `auth-failure-detect-freshness.test.ts` + this new file): 16/16
pass. `npx eslint` and `tsc --noEmit` both clean on the two changed files.
