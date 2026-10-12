## 2026-10-12 — [Dead code] Unused useAppAuth() destructure left in AccountProfilePanel — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Dead code | P3 — harmless at runtime, pure cleanup | FIXED |

**What's wrong.** `src/components/account/AccountProfilePanel.tsx`:
```tsx
export function AccountProfilePanel() {
  const { email, tier, signOut, isLoaded } = useAppAuth();

  return <UserProfile appearance={CLERK_APPEARANCE} />;
}
```
None of `email`, `tier`, `signOut`, `isLoaded` are referenced anywhere in the function body —
the component just renders Clerk's `<UserProfile>`. Traced to commit `e168eab0f` ("retire the
last of the Cognito switch", #1967), which deleted the branch that actually consumed these
values (a Cognito fallback UI) but left the now-pointless `useAppAuth()` destructure behind.

**Why nothing caught it.** `useAppAuth()` (`src/lib/auth-client.tsx:60-63`) is a pure
`useContext` read with no side effects, so calling it or not makes no behavioral difference —
and this repo's eslint config doesn't flag unused destructured variables here (confirmed:
`npx eslint` on the file was clean both before and after this fix). Nothing short of reading the
function body would surface it.

**Fix.** Removed the dead destructure and the now-unused `useAppAuth` import. No behavior
change — `useAppAuth()` has no side effects, so dropping the call changes nothing about what
renders.

**Verification.** `tsc --noEmit` clean; `npx eslint src/components/account/AccountProfilePanel.tsx`
clean before and after (confirming this really was inert, not silently load-bearing). No test
added — there is no behavioral surface to test for a pure dead-code deletion with a verified
side-effect-free removed call.

**Blast radius.** This file only — `AccountProfilePanel` has no other callers of the removed
values.

Found via a background Explore-agent sweep of the billing/account/admin surface, independently
re-verified (confirmed zero references to the four destructured names in the function body, the
hook's side-effect-free implementation, and the originating Cognito-removal commit) before
fixing.
