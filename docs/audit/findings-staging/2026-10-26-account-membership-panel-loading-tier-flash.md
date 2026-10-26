## `/account`'s Membership panel flashes the Upgrade CTA for every member, including paying ones, before Clerk finishes loading

> **kind:** `FINDING`

### Root cause

`AccountMembershipPanel.tsx` reads `useAppAuth()`'s `{ tier: rawTier, isLoaded }` and fed `rawTier`
straight into `resolveDisplayTier()` without checking `isLoaded` first. `useAppAuth()`'s documented
unloaded default (`src/lib/auth-client.tsx`) is `tier: null`, and `resolveDisplayTier(null)` →
`parseTier(null)` → falls through to `"free"` (`src/lib/tiers.ts`) — there is no third "unknown"
state, `null` resolves to the same value as a genuinely-free member.

So on every `/account` load, for the entire window before Clerk resolves (first paint, a page
refresh, a slow network), `tier === "free"` evaluates `true` regardless of the member's real tier,
and the panel renders the FREE-tier branch: an `Upgrade` CTA for the "Current plan" action, and the
paid-tier billing-portal explanation paragraph hidden. A Premium or SPX-Slayer member's own account
page would briefly show "Upgrade" next to their own plan, before snapping to the correct
"Manage subscription" state once Clerk loads.

The sibling component `PlanLadder.tsx` (`src/components/upgrade/PlanLadder.tsx`) reads the exact
same `useAppAuth()` shape and already guards correctly: `hasCommunity = isLoaded &&
tierAtLeast(userTier, "community")` — ANDing `isLoaded` into every tier-gated boolean so nothing
tier-dependent renders before the real value is known. `AccountMembershipPanel` never received the
matching guard.

### Evidence

Added `resolveMembershipPanelView(rawTier, isLoaded)` (pure, exported) + 3 regression tests in
`AccountMembershipPanel.test.tsx`:
- `resolveMembershipPanelView(null, false)` / `resolveMembershipPanelView("premium", false)` must
  both return `{ tier: null }` — the real rawTier is irrelevant while `isLoaded` is false.
- Once `isLoaded`, resolves `"free"`/`"premium"`/`"community"`/`"admin"→"premium"` exactly as
  `resolveDisplayTier` already does.
- A full-component `renderToStaticMarkup` render with **no** `ClerkAuthBridge` wrapper (so
  `useAppAuth()` falls back to its documented `unloaded` default, reproducing a real first-paint
  before Clerk resolves) asserts the output shows `"Loading…"` and contains **neither**
  `href="/upgrade"` **nor** `"Manage subscription"`.

Confirmed RED pre-fix via `git stash` (isolating only `AccountMembershipPanel.tsx`): test 1 and 3
failed — the unloaded render actually contained `<a href="/upgrade" ...>Upgrade</a>`, reproducing
the bug exactly. GREEN post-fix: 3/3 pass. `tsc --noEmit` clean. Single real call site
(`src/app/(site)/account/page.tsx`), used with no props — the fix is a pure internal refactor with
no caller-facing API change.

### Blast radius

One file, one component, one call site. No other component reads `AccountMembershipPanel`'s
exports; `resolveMembershipPanelView` is new and newly exported, so nothing could have depended on
the old (buggy) inline logic.

### Fix rationale

Extracted the tier-resolution branch into a pure `resolveMembershipPanelView(rawTier, isLoaded)`
that returns `tier: null` while loading (never resolving a tier at all) instead of resolving to a
default that happens to collide with a real value — the same "a nullable field, not a fabricated
default" discipline the Largo product contract's "absence principle" and this repo's `FreshnessChip`
staleness logic already use elsewhere. Every render branch now checks `tier` for truthiness before
branching on its value, so nothing tier-dependent paints until the real tier is known. Deliberately
did NOT change `resolveDisplayTier`/`parseTier` themselves (both are also used by `Ga4ConversionTracker`
for conversion-event detection and are documented as intentionally never returning an "unknown"
state) — the fix stays local to this one component's own consumption of them.

| **Status** | Fixed in PR #TBD (branch `fix/account-membership-panel-loading-flash`) |
|---|---|
