> **kind:** FINDING

## Membership-activating banner permanently invisible behind the opaque nav bar — FIXED

| | |
|---|---|
| **Component** | `src/components/MembershipActivatingBanner.tsx` |
| **Status** | FIXED — PR (this branch) |

### Root cause

`MembershipActivatingBanner` renders `fixed inset-x-0 top-0 z-[90]` — the post-checkout "Activating
membership… desk access unlocks automatically once payment confirms" status strip shown to a
member who just paid but whose Clerk tier hasn't synced yet.

`.nav-bar` (`globals.css`) is `fixed top-0 inset-x-0 z-[100]`, and `Nav.tsx` sets
`data-scrolled={!isHome ? "true" : "false"}` on its very first render — `isHome` is `path === "/"`.
`AppShellProviders` (which mounts the banner) is explicitly documented as "NOT loaded on the public
marketing homepage," so every route the banner can appear on is, by construction, a route where
`isHome` is false and `data-scrolled` is `"true"` from the very first paint, with no scroll required.
`.nav-bar[data-scrolled="true"] .nav-surface { opacity: 1; }` makes the nav's full-width,
full-height surface fully opaque immediately.

The banner (z-90) and the nav (z-100) both occupy the same `fixed`, full-width, top-0 region, with
the banner's height comfortably inside the nav's 60-76px band. Since the nav wins the z-order and is
opaque from the first render on every page this banner can mount on, the banner was rendered
completely hidden behind it — 100% of the time, not just on scroll. The only UI telling a member
their payment is still activating was permanently invisible.

### Evidence

- Code: `.nav-bar { @apply fixed top-0 inset-x-0 z-[100]; ... }` and
  `.nav-bar[data-scrolled="true"] .nav-surface { opacity: 1; }` (`src/app/globals.css`);
  `data-scrolled={!isHome ? "true" : "false"}` and `const isHome = path === "/";` (`src/components/Nav.tsx`).
- Live confirmation (production, `/account`, free-tier temp Clerk user, 430×932 viewport via
  `proxy-browser.cjs`'s tunneled context): `document.querySelector(".nav-bar")` returned
  `data-scrolled: "true"`, `getComputedStyle(nav).zIndex: "100"`, and
  `getComputedStyle(navSurface).opacity: "1"` — confirming points 1-3 above are true on prod right
  now, not just in source.
- The banner element itself could not be made to render under this same harness to screenshot the
  overlap directly: `window.Clerk.user`/`window.Clerk.session` are null client-side in this audit
  harness (confirmed via `window.Clerk` diagnostic: `loaded: true`, `hasUser: false`,
  `hasSession: false`, no `__client` cookie present) even though the server-rendered page itself
  correctly shows "CURRENT PLAN: Free." This is the exact, already-documented harness limitation
  CLAUDE.md records from rounds 62/63 of this session (`useUser()`/`useAuth()` never hydrate
  client-side under this audit cookie jar, which lacks `__client`) — not a product bug, and not
  something that changes the conclusion above, since the nav's live opacity/z-index were confirmed
  independently of the banner's own render path.

### Fix

Raised the banner's z-index from `z-[90]` to `z-[105]` — above `.nav-bar`'s `100`, below the next
tier in the app's existing layering convention (`.vector-page-content-focus`/`.vector-page-inner-focus`
at `110`, `.onboarding-overlay` at `120`). Added a regression test
(`MembershipActivatingBanner.test.ts`) that extracts both z-index values from source via regex and
asserts the banner's stays strictly above the nav's, so a future nav z-index bump can't silently
re-bury it again — the same ratchet shape `vector-focus-mode.test.ts` already uses for the
sibling Vector-focus-mode z-index ordering bug this codebase hit before.

### Blast radius

Single call site (`AppShellProviders`/`DeskShell` mounts one instance globally) — no other
component renders this banner.
