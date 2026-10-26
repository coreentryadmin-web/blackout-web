> **kind:** `FINDING`

## Admin-set `tool_access: block` override silently bypassed for every already-launched tool once the session JWT carries tier/role — FIXED

| | |
|---|---|
| **Severity** | P1 (access control — a moderation action an admin took had no effect) |
| **Surface** | `src/lib/tool-access-server.ts` — `userCanAccessTool`, the server-side gate behind `canAccessTool`/`requireToolApi`/`requireAnyToolApi`, which every desk page and desk API route (`/dashboard`, `/flows`, `/heatmap`, `/nighthawk`, `/vector`, `/meridian`) calls to decide whether a signed-in user may use a tool. |
| **Status** | FIXED |

### Root cause

`userCanAccessTool` has three paths, in order: (1) admin bypass, (2) a fast path that trusts a
`tool_access` claim in the session JWT when present, (3) a fallback that reads the real stored
override via a cached `getUser` call. Between (2) and (3), a prior commit (`#2344`, "JWT tool gate
fast path") added a shortcut:

```ts
if (global && sessionClaimsHaveAuthFields(sessionClaims)) {
  return true;
}
```

`global` is `isToolLaunched(key)` — `true` for every tool except Largo (`spx`, `flows`, `heatmap`,
`nighthawk`, `vector`, `meridian` are all `defaultLaunched: true` in `src/lib/tool-access.ts`).
`sessionClaimsHaveAuthFields` is true whenever the JWT carries a `tier` or `role` claim — which,
per `docs/clerk/SESSION-TOKEN-CLAIMS.md`'s own documented (and actual production) Dashboard setup,
is every ordinary signed-in session (the Dashboard claims editor is configured with `tier` and
`role` only; `tool_access` is never added to the token). So in practice this shortcut fired, and
returned `true`, for essentially every request against every already-launched tool —
**unconditionally, without ever consulting the real `tool_access` override stored in Clerk
`publicMetadata`.**

That override is a real, actively-supported admin feature, not a theoretical one:
`POST /api/admin/users/tools/bulk` and the single-user `PATCH /api/admin/users/[id]` route both
let an admin set `block`/`grant` on any of the 7 tool keys, including the 6 already-launched
ones (`VALID_TOOLS`/`TOOLS` in both routes carry no exclusion for launched tools). An admin who
blocked a user from, say, Vector or Night Hawk because of abuse, and then confirmed it from the
admin UI, would see the block recorded — but the user kept full access to that tool on every
ordinary request, because the gate never looked at the override once their session JWT carried
the normal tier/role claims.

The only tool this did NOT silently break was Largo (`defaultLaunched: false`): since `global` is
false there, the shortcut's `global && ...` condition never holds, so Largo always correctly fell
through to the real override check — which is presumably why this went unnoticed; the one tool
whose gate is exercised constantly in practice (Largo access requests) never hit the bug.

### Evidence

New behavioral test (`src/lib/tool-access-server-block-override.test.ts`) imports the real
`userCanAccessTool` (with `server-only`/`react`/`next/navigation` stubbed just enough to let the
real module load under `tsx --test` — none of those stubs touch the logic under test) and a mocked
`getClerkUserCached` backing a real stored `{ vector: "block" }` override:

- Before the fix: `userCanAccessTool(userId, "vector", { tier: "premium", role: "member" })`
  returns `true` — the block is ignored outright, and `getClerkUserCached` is never even called
  (confirmed via a call counter), proving the stored override was never consulted at all.
- After the fix: the same call returns `false`, and `getClerkUserCached` is called exactly as
  expected.

RED→GREEN confirmed via `git stash` on `src/lib/tool-access-server.ts` alone (test file
untouched): the behavioral test and the existing `tool-access-server.latency.test.ts` source-text
guard both fail against the pre-fix source and both pass against the fix.

### Blast radius

Every already-launched tool (`spx`, `flows`, `heatmap`, `nighthawk`, `vector`, `meridian`) via
every call site that reaches `userCanAccessTool`: `canAccessTool` (page gate), `requireToolApi`,
`requireToolApiForDeskCaller`, `requireAnyToolApi` (API gates). Largo (`defaultLaunched: false`)
was never affected — its gate always consulted the real override, since the buggy shortcut's
`global` condition never held for it. No other file needed to change; the bug was entirely
contained to the one shortcut in `tool-access-server.ts`.

### Fix

Removed the `global && sessionClaimsHaveAuthFields(sessionClaims)` shortcut entirely. The function
now always either (a) trusts a real `tool_access` claim when the JWT carries one, or (b) falls
through to the cached `getClerkUserCached` read (same 5s-TTL cross-request dedupe cache
`isAdminUser`'s own slow path already uses) to read the actual stored override — restoring the
pre-`#2344` correctness guarantee while keeping the genuine latency win from `#2344` intact for the
case that win was actually cheap for (a per-tool JWT claim, when configured). Removed the
now-unused `sessionClaimsHaveAuthFields` import from this file (the function itself is untouched
and still independently unit-tested in `clerk-session-claims.test.ts`).

### Fix rationale

The alternative of leaving the shortcut and instead telling operators to add a `tool_access` claim
to the Clerk Dashboard JWT template would require an out-of-band, unenforced manual step that the
documented setup (`docs/clerk/SESSION-TOKEN-CLAIMS.md`) never asks for today — leaving the gap live
in the current, real production configuration until someone remembered to go do that. Removing the
unsafe assumption in code fixes the gap unconditionally, with no dependency on a Dashboard change
nobody is currently told to make. The remaining cost is one more `getClerkUserCached` call (cached
5s cross-request) for a signed-in, non-admin request against an already-launched tool when no
`tool_access` JWT claim is present — not a regression to the pre-`#1225`/`#2344` "3-5 Clerk calls
per render" problem those PRs fixed, since `getClerkUserCached`'s cache is shared and already paid
for by other call sites on the same request/short window.

### Tests

`src/lib/tool-access-server-block-override.test.ts` (new, 3 cases: a real block on an
already-launched tool is honored; an ordinary member with no override still gets the tool; a real
grant override still unlocks Largo). `src/lib/tool-access-server.latency.test.ts` updated — its
assertion that the removed shortcut's source text is present is replaced with a `doesNotMatch`
regression guard so the bypass can't silently come back. Both files run clean under
`npx tsx --experimental-test-module-mocks --test` on Node 20, alongside the existing
`clerk-session-claims.test.ts`, `tool-user-access.test.ts`, `sse-stream-entitlement-revalidate.test.ts`,
`gated-route-redirects.test.ts`, and the admin users/bulk route tests (all green, unaffected).
`npx tsc --noEmit` clean. `npx eslint` clean on all changed files.
