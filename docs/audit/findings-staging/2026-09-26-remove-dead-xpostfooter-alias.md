## Dead-code: `xPostFooter()` deprecated pure-passthrough alias in `x-content.ts` had zero remaining callers — REMOVED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | X (Twitter) auto-post content generation — dead-code hygiene |
| **Severity** | P4 (dead code, no behavior change, no runtime impact) |
| **Status** | FIXED |
| **Files** | `src/lib/x-content.ts` |

### Root cause

`src/lib/x-content.ts` carried a `@deprecated` pure-passthrough alias:

```ts
/** @deprecated use xPostFooterLine(postType) from x-whop-link */
export function xPostFooter(): string {
  return xPostFooterLine();
}
```

A repo-wide grep (`grep -rn "\bxPostFooter\b"` across `src`, `scripts`, and the rest of the tree,
excluding `node_modules`/`.next`) found zero remaining references anywhere outside its own
definition — no call site, no re-export, no test. The one real caller
(`src/app/api/cron/x-autopost/route.ts`) already migrated to the canonical
`xPostFooterLine(postType)` from `x-whop-link.ts`, which is also still imported and used twice
elsewhere in `x-content.ts` itself (`composeHooked...`/footer-attach call sites), so this alias's
only remaining purpose was a stale migration bridge nobody was crossing anymore — same shape as
the `isEtMarketHours` deprecated-alias removal from 2026-09-23 (`docs/audit/FINDINGS.md`, folded
via PR #5484).

### Evidence

```
$ grep -rn "\bxPostFooter\b" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules --exclude-dir=.next
./src/lib/x-content.ts:87:export function xPostFooter(): string {
```

Only its own definition — no importer, no test coverage (`x-content.ts` has no dedicated test
file, and no other test file imports from it either).

### Fix

Deleted the 4-line dead function. `xPostFooterLine` (the canonical replacement) remains imported
and used at its two existing call sites in the same file — import unaffected.

`tsc --noEmit` clean. `eslint src/lib/x-content.ts` clean. No test needed to add/prove
RED→GREEN: the removed function had zero test coverage anywhere in the repo to begin with (pure
deletion of unreachable code, not a behavior change).

### Blast radius

None — `xPostFooter` had no callers, so no other file needed updating.
