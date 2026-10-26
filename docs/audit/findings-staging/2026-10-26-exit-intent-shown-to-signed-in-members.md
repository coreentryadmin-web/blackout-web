## Site-wide exit-intent lead magnet fired for already-signed-in members, not just prospects

> **kind:** `FINDING`

### Root cause

`ExitIntentCapture.tsx` (mounted once in `MarketingPageShell`, so it applies to every
`(marketing)` route — `/pricing`, `/faq`, `/about`, `/why-blackout`, `/learn/*`, etc., not just
signed-out landing pages) arms a top-edge mouse-exit detector after a 4s delay and, once per
browser session, pops a modal pitching a "free GEX cheat sheet" email-capture lead magnet.

The arming effect checked only `alreadyShownThisSession()` (a `sessionStorage` flag) before
scheduling the arm timer — it never checked whether the visitor is already signed in. A signed-in
member (free or paying) browsing any marketing page — e.g. checking `/pricing` for a different
tier, or `/faq` — could trigger the exit-intent gesture and get shown a lead-generation popup
offering them something they already have no use for: they already have an account.

The repo already has the exact signal needed for this and uses it elsewhere:
`readClientSignedIn()` (`src/lib/client-signed-in.ts`) reads the non-httpOnly `__client_uat`
cookie and is the same mechanism `NavAuthLinks.tsx`/`useMarketingSignedIn` use to render
auth-aware nav chrome on these same lean marketing pages. `ExitIntentCapture.tsx` never imported
or called it.

### Evidence

Added a regression test (`ExitIntentCapture.test.ts`) asserting (1) the component imports
`readClientSignedIn` from `@/lib/client-signed-in`, and (2) the arming `useEffect` checks
`readClientSignedIn() === true` and bails out before the arm timer is scheduled. Confirmed RED
pre-fix (`git stash` isolating the source file, 1/2 tests fail — the new check fails because
neither the import nor the gate exist yet) → GREEN post-fix (2/2 pass). `tsc --noEmit` and
`eslint` on the changed files both clean.

### Blast radius

Single component, single mount point (`MarketingPageShell`), so a single effective call site.
No other file reads or writes the exit-intent arming logic. The fix is purely additive (one early
return using an already-existing, already-tested shared helper) and does not change behavior for
a genuinely signed-out visitor — the existing `alreadyShownThisSession()` gate, 4s arm delay, and
top-edge mouse-exit detection are all unchanged.

### Fix rationale

Gate on `readClientSignedIn() === true` the same way `useMarketingSignedIn` does, rather than
inventing a new signal. This component is client-only (`ssr: false` via `LazyExitIntentCapture`,
confirmed in that file's own comment) and renders nothing until a user gesture fires, so there is
no hydration-mismatch risk in reading `document.cookie` directly inside the effect — unlike
`useMarketingSignedIn`'s own documented constraint (its *initial* render state must match the
server's guess exactly, for hydration reasons that don't apply here). A `null` result (cookie
absent — genuinely signed-out, or SSR) is treated as "proceed as normal," only an explicit `true`
suppresses arming.

| **Status** | Fixed in PR #TBD (branch `fix/exit-intent-signed-in-member`) |
|---|---|
