## 2026-09-06 — [FINDING, root layout, P3] `/meridian` still missing from a FOURTH hand-maintained route list — FIXED

> **kind:** `FINDING`

### Symptom

Found during a DISCOVERY-lane sweep of foundational, shared, non-desk-specific files
(`src/middleware.ts`, `src/app/layout.tsx`, error/loading boundaries) for the population/cohort
and dead-code bug classes already fixed repeatedly elsewhere this session.

### Root cause

`src/desk-protected-route-coverage.test.ts` documents a live 2026-09-04 incident: `/meridian`
shipped as a real, tier-gated desk (`layout.tsx` calls `requireDeskTool("premium", "meridian")`)
but was missing from **three** independent hand-maintained route-prefix lists
(`isProtectedRoute` in `middleware-clerk.ts`, `PROTECTED_PREFIXES` in `middleware-shared.ts`,
`DISALLOWED_ROOTS` in `robots.ts`). All three were patched and a regression test was added — but
`src/app/layout.tsx`'s own boot script carries **two more** hand-maintained route regexes, and
neither was touched by that fix or covered by its test:

```js
// product-shell — freezes ambient GPU loops on desk routes
/^\/(dashboard|flows|heatmap|terminal|nighthawk|vector|grid|account|admin|upgrade)(\/|$)/

// ios-app-pending-shell + data-ios-route — lets ios-native-*.css apply before hydration
/^\/(dashboard|flows|heatmap|terminal|nighthawk|vector|grid|account|faq|learn|upgrade|admin)(\/|$)/
```

Both are missing `meridian` — the same "one more hand-maintained list nothing derives from the
layout gates" root cause recurring in a fourth location, two days after the first three were fixed.
Concrete impact: `/meridian` never gets the `product-shell` class (misses the same
ambient-GPU-freeze perf treatment every sibling desk gets), and in the iOS app embed it never gets
`ios-app-pending-shell`/`data-ios-route`, so route-specific `ios-native-*.css` can't apply before
hydration — a flash of the wrong (web) chrome for iOS users opening Meridian, unlike every other
desk. Not a security issue (middleware/robots.ts still gate real access) — a worse first paint.

Also found and fixed in the same regexes: a stale `grid` token. No `src/app/**/grid` route exists
anywhere in the app router (confirmed via `find`) — a leftover from a since-renamed/removed "Grid"
desk (referenced in PR #557's commit message). Harmless (never matches), but exactly the kind of
unmaintained duplicate list that produced the `meridian` gap above.

### Fix

Added `meridian` to both regexes; removed the stale `grid` token from both. Added the missing
`data-ios-route='meridian'` branch to the if/else dispatch chain, matching the existing convention
where every real desk in the pending-shell list gets a corresponding attribute value (verified no
`ios-native-*.css` file currently keys off `[data-ios-route="meridian"]`, so this is forward-
compatible groundwork, not a behavior change today).

Extended `desk-protected-route-coverage.test.ts` (the existing regression-guard file for this exact
bug class) with a **fourth** check: it now scans `layout.tsx`'s two boot-script regexes for every
tier-gated desk slug, the same way it already checks the other three lists. The next gated desk
added under `(site)/` now fails immediately in all four lists if any one is missed, not just three.

### Evidence

- RED→GREEN: `git stash push -- src/app/layout.tsx` (keeping the new test) → new test fails
  (`meridian` absent from both regexes) → `git stash pop` → 5/5 pass.
- `npx tsc --noEmit`: clean.
- Targeted tests (`desk-protected-route-coverage`, `site-shell-perf`): 17/17 pass.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

`src/app/layout.tsx` (2 regex edits + 1 new `data-ios-route` branch, inline boot script only) and
`src/desk-protected-route-coverage.test.ts` (+1 test, updated header comment). No other consumer of
either regex exists (both are inline strings in a single `dangerouslySetInnerHTML` script).

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
