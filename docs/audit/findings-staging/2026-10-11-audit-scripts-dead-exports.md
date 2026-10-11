## Audit scripts — 4 dead exports across 3 lib files: `mintClerkSessionViaPlaywright`, `buildCreativeCopy`+`nextCopyOpener`+`COPY_OPENERS`, `nextPanelPack` — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/audit-scripts-dead-exports) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep of
`scripts/audit/lib/*.mjs` (the pure-logic helpers behind the audit scripts — real app-adjacent
code, not disposable scripts), not a production defect.

**Root cause:**
- `mintClerkSessionViaPlaywright` (`admin-e2e-auth.mjs`) completes a Clerk ticket sign-in through a
  headless Playwright browser. Zero callers anywhere — not even its own test file (none exists for
  this module). The repo's real, documented auth pattern (CLAUDE.md "Access reality" §1) is the
  pure-HTTP FAPI-ticket-exchange flow via `mintClerkPremiumSession` (imported at the top of this
  same file from `prod-clerk-session.mjs`), which needs no browser — this Playwright-based
  alternative appears to have been superseded by that and never removed.
- `buildCreativeCopy` (`x-social-creative.mjs`) built X-post copy from a live story + captured
  panels. Zero production callers — `composeCreativePack` (same file), the function `x-social-post.mjs`
  actually imports, builds its pack without ever calling this copy builder. Its own exclusive
  helper `nextCopyOpener` (LRU-rotating opener line picker) had no other caller either, and that
  helper's own exclusive data array `COPY_OPENERS` had no other caller once `nextCopyOpener` is
  gone — all three removed together rather than leaving two newly-orphaned siblings behind.
- `nextPanelPack` (`x-social-post-kit.mjs`) picks the next panel pack by LRU rotation. Zero
  production callers — `getPanelPack(slug)` (same file, explicit-slug lookup) is the one
  `x-social-post.mjs` actually calls.

**Evidence:** `grep -rn "<name>" scripts/` for each of the 4 removed names → only each definition
and its own direct test (or, for `mintClerkSessionViaPlaywright`, no test at all), before the fix.

**Fix:** Removed all 4 plus their now-orphaned exclusive dependents. Removed the corresponding
imports and direct tests from `x-social-creative.test.mjs` and `x-social-post-kit.test.mjs`.
Confirmed `loadCreativeState`/`saveCreativeState`/`lruPick` (x-social-creative.mjs) and
`loadRotation`/`saveRotation`/`lruPick` (x-social-post-kit.mjs) each have other real callers within
their own file and are untouched; `fmtPrem`/`fmtGex` (x-social-creative.mjs) are imported
independently by `x-social-story-data.mjs` and are untouched.

**Fix rationale:** Pure deletion in all 4 cases — each had a live sibling doing the real job
(`mintClerkPremiumSession`, `composeCreativePack`, `getPanelPack`), so there was no call site to
redirect.

**Blast radius:** `scripts/audit/lib/admin-e2e-auth.mjs`, `scripts/audit/lib/x-social-creative.mjs`,
`scripts/audit/lib/x-social-creative.test.mjs`, `scripts/audit/lib/x-social-post-kit.mjs`,
`scripts/audit/lib/x-social-post-kit.test.mjs` only.

**Regression guard:** `x-social-creative.test.mjs` + `x-social-post-kit.test.mjs` 4/4 pass (plain
`node --test`, these are standalone `.mjs` audit-tooling files, not part of the TS build).
