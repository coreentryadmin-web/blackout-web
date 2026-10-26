> **kind:** FINDING

## Modal portal tied at the same z-index as `.nav-bar` — fragile, not currently broken — FIXED

**Status:** FIXED — PR #TBD

### Root cause

`src/components/ui/Modal.tsx`'s root panel used `z-[100]`, the exact same value as `.nav-bar`
(`src/app/globals.css:1555`). Both are `fixed`, full-viewport-spanning elements, so with an equal
z-index the browser falls back to DOM paint order (the later-painted sibling wins) rather than an
explicit stacking guarantee.

This was found as a direct follow-up while investigating the nearby bug fixed in PR #6859
(`MembershipActivatingBanner` at `z-[90]`, strictly *below* `.nav-bar`'s `z-[100]` — a real,
always-reproducing bug, not a tie). That PR's own report flagged this tie as worth a second look.

### Evidence

- `.nav-bar { @apply fixed top-0 inset-x-0 z-[100]; ... }` — `src/app/globals.css:1554-1559`.
- `Modal.tsx` portals via `createPortal(<AnimatePresence>...</AnimatePresence>, document.body)`
  — appended to `document.body` only while `open` is `true`, i.e. always *after* the already-
  hydrated app root (which contains `.nav-bar`) in DOM order. By the standard equal-z-index /
  later-DOM-sibling-wins rule, this means the Modal currently always visually wins the tie —
  **not broken today**, confirmed by reading the mount mechanism rather than guessing.
- The repository has an established, carefully-documented z-index tier scheme elsewhere
  (`globals.css` lines ~1966, ~12282-12299, ~23179-23183: 90/95 → 100 (nav) → 105 (banner, PR
  #6859) → 110 (full-takeover views: Vector focus-mode, Night Hawk deck sheet) → 120
  (onboarding-overlay) → 140/150 (mobile nav-sheet scrim/panel)) — every other near-nav layer is
  given an explicit, strictly-ordered value. Modal was the one layer relying on DOM-order luck
  instead of an explicit value.

### Blast radius

Every consumer of `<Modal>`/`<Drawer>` (shared component, multiple non-owned dialogs) was exposed
to this fragility — a future refactor that changes WHEN or WHERE `.nav-bar` mounts relative to the
app root (e.g. portaling the nav itself, or restructuring `AppShellProviders`) could silently flip
the tie and bury every modal in the app behind the site nav, with no test catching it.

### Fix rationale

Bumped Modal's root z-index from `z-[100]` to `z-[106]` — strictly above `.nav-bar` (100) and the
membership-activating banner (105, so a dialog isn't buried by a status strip either), and
strictly below the 110 "full takeover" tier and the 120 onboarding-overlay (a plain dialog
shouldn't outrank either of those). Added a short in-code comment explaining why an explicit
margin matters here specifically (the DOM-order premise it no longer needs to rely on).

Added `src/components/ui/Modal.test.ts`: one test extracts both z-index values from source and
asserts `Modal > nav-bar` (same pattern `MembershipActivatingBanner.test.ts` uses for the sibling
bug), and a second test pins the `createPortal(..., document.body)` mount mechanism itself, so a
future refactor that breaks either premise fails loudly instead of silently re-introducing the
fragility.

RED→GREEN proven via a temp-file swap (not `git stash`, per this session's standing avoidance of
stash on the shared sandbox working directory): the pre-fix `z-[100]` shape fails the ordering
assertion; the `z-[106]` fix passes both tests. `npx eslint` and `npx tsc --noEmit` clean; full
`src/components/ui/*.test.ts` + `src/components/*.test.ts` suite (25 tests) passes.
