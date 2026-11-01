> **kind:** FINDING

## `IOS_TOOL_NAV_LABELS` in `src/lib/ios-tool-routes.ts` is a dead, orphaned re-derivation with zero consumers — FIXED

**Status:** FIXED. **Severity:** P3 (dead code, no behavior change — a maintainability/dead-code
finding, not a correctness bug). **Area:** `src/lib/ios-tool-routes.ts`.

### What's wrong

`IOS_TOOL_NAV_LABELS` (`Record<IosToolRoute, string>`, derived from `IOS_TOOLS`) had zero
references anywhere in the repo outside its own definition — confirmed by a repo-wide grep across
every file type (`.ts`/`.tsx`/`.mjs`/`.js`), excluding `node_modules`/`.git`.

### Root cause (traced with `git log -S`, same discipline as #7062/#7139)

It was a real, live lookup table when introduced in #556 ("premium polish — nav context, motion,
touch targets"): `getIosToolNavLabel` was originally implemented as
`IOS_TOOL_ROUTES.find(...)` → `IOS_TOOL_NAV_LABELS[match]`. #557 ("native product shell — header,
menu, floating dock") introduced the richer `IOS_TOOLS`/`IosToolMeta` array (label + short + mark +
accent + tagline + instrument code, needed for the new native header/tab-bar/menu chrome) and
rewrote `getIosToolNavLabel` to read `getIosToolMeta(path)?.label` directly off that array instead
— a strictly better single source of truth. But the same commit kept re-deriving
`IOS_TOOL_NAV_LABELS = Object.fromEntries(IOS_TOOLS.map(...))` right next to it, even though
nothing read it anymore. `git log --all -S"IOS_TOOL_NAV_LABELS"` returns only those two commits
(#556 defining it, #557 redefining-but-orphaning it) — never a third commit adding a consumer.
Same shape as #7062's `getIosTabRailIndex` (a helper whose real job was taken over by a different
mechanism, leaving the original as inert dead weight) and #7139's `UW_DOCS_*` constants (orphaned
when their only consumers were deleted) — a recurring "refactor moves the real source of truth,
forgets to delete the old derivation" bug class in this codebase.

### Evidence

- Repo-wide grep (worktree checked out from `origin/main`, no drift — `git fetch origin main -q &&
  git log HEAD..origin/main --oneline | wc -l` → `0`): `grep -rn "IOS_TOOL_NAV_LABELS" .` (minus
  `node_modules`/`.git`) matches only the one `export const` line.
- `src/lib/ios-tool-routes.test.ts` (pre-existing, 15 tests) never imported or asserted on
  `IOS_TOOL_NAV_LABELS` — only on `getIosToolNavLabel`, which is independently backed by
  `getIosToolMeta`/`IOS_TOOLS`.
- Added a new test pinning the module's export surface (mirrors #7139's
  `uw-docs-catalog.test.ts` pattern): parses `export const|function` names out of the source file
  and asserts the set is exactly the 11 live exports, with `IOS_TOOL_NAV_LABELS` explicitly absent.
  **RED→GREEN verified**: with the export temporarily restored (old code, new test), the new
  assertion fails (`15 pass / 1 fail` of 16 total); with the export removed, `16/16` pass.
- Scoped run after the fix: `npx tsx --experimental-test-module-mocks --test
  src/lib/ios-tool-routes.test.ts src/lib/ios-tab-rail.test.ts src/lib/ios-app-shell.test.ts
  src/components/ios/IosNativeSegment.test.tsx` → `22/22` pass. `npx tsc --noEmit -p .` clean.

### Blast radius

Single export in a single file. Checked every consumer of `ios-tool-routes.ts`
(`IosNativePageTransition.tsx`, `IosNativeMenu.tsx`, `IosAppChrome.tsx`, `IosLargoFab.tsx`,
`IosNativeHeader.tsx`, `Nav.tsx`, `IosAppTabBar.tsx`, `useIosNativeShell.ts`) — none import
`IOS_TOOL_NAV_LABELS`; all use `getIosToolNavLabel`/`getIosToolMeta`/`IOS_TOOLS` directly, which are
untouched.

### Fix rationale

Removed only the orphaned constant. Left `IOS_TOOLS`, `getIosToolMeta`, and `getIosToolNavLabel`
exactly as-is — they are the real, live source of truth this constant was a stale duplicate of.
No behavior change: the constant was never read, so nothing downstream can observe its removal
except the new test that pins its absence.
