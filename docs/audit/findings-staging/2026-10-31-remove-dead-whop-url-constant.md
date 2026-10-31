> **kind:** FINDING

## `WHOP_URL` in `src/lib/x-content.ts` — dead constant, zero references — REMOVED

| | |
|---|---|
| **Area** | X/social autopost content generation (`src/lib/x-content.ts`) |
| **Severity** | P4 (dead code, zero runtime impact) |
| **Status** | FIXED |

### Root cause

`WHOP_URL` (`export const WHOP_URL = "whop.com/blackout-2d9c";`) was added in
commit `6ee09cb68` (#847, "`@BlackOutTrade` identity, quality gates, engagement crons")
as the only value consumed by a sibling function in the same file:

```ts
export function xPostFooter(): string {
  return `${TAG} ${WHOP_URL}`;
}
```

That function was later superseded by the canonical `xPostFooterLine(postType)` in
`src/lib/x-whop-link.ts` (which carries its own, independent `WHOP_BASE` constant plus
UTM tagging), and `xPostFooter()` itself was removed as dead code in PR #5504
(`addfb6527`, 2026-09-26, "remove dead `xPostFooter` deprecated passthrough alias").
That PR's own diff shows it deleted the function but left the `WHOP_URL` constant one
line above it untouched — the constant's only consumer was removed, but the constant
itself was not caught by the same sweep.

Since #5504 merged, `WHOP_URL` has had **zero references anywhere in the repository
outside its own declaration** — confirmed via `git log --all -S"WHOP_URL"` (only the
original-add and the fold-staging commits ever touch the string) and a repo-wide
`grep -rn "WHOP_URL"` from a fresh `origin/main` checkout, both before and after the
removal in this PR.

### Why it wasn't caught earlier

The same shape as the `isEtMarketHours`/`xPostFooter` alias removals this PR's own
commit message cites as precedent: a function removal correctly deleted the dead
*consumer* but the dead *constant* that fed only that consumer one line above it
was out of the diff's immediate attention and slipped through.

### Evidence

- `grep -rn "WHOP_URL" --include="*.ts" --include="*.tsx" .` (repo root, pre-fix):
  exactly one hit — the declaration itself (`src/lib/x-content.ts:84`).
- `git log --all --oneline -S"WHOP_URL" -- src/lib/x-content.ts`: only the original add
  (`6ee09cb68`/`cd3b224bf`, #849) and this PR's own fold-staging ancestor touch the
  symbol; no commit in between ever added a new reference.
- The *value* `"blackout-2d9c"` (the Whop store slug) is still live and used elsewhere
  under different, independently-maintained constants — `WHOP_BASE` in
  `src/lib/x-whop-link.ts` (`"https://whop.com/blackout-2d9c"`, used by the canonical
  `whopMarketingUrl`/`xPostFooterLine`) and `LINKS.whop` in
  `src/lib/x-intel/cta.ts` (`"https://whop.com/joined/blackout-2d9c/"`, a different
  path/referral variant with its own UTM tagging) — so this is a genuine leftover
  constant, not a case where a currently-used literal should be wired back to this
  symbol (checked per round 146's lesson re: `GA4_PENDING_SIGNUP_KEY`/PR #7007): the
  three strings differ in scheme and path and serve three independently-evolved call
  sites, not one duplicated value.

### Blast radius

None. `WHOP_URL` was `export`ed but had no importers anywhere in `src/` (checked via
repo-wide grep across every consumer of `@/lib/x-content`:
`src/app/api/cron/x-autopost/route.ts`, `src/app/api/cron/x-replies/route.ts`,
`src/app/api/cron/x-intel/route.ts`, `src/lib/x-desk-card.tsx`,
`src/lib/x-mention-replies.ts` — none reference `WHOP_URL`).

### Fix rationale

Delete the constant outright. No test existed for it (it had zero runtime
consumers to test), matching PR #5504's own precedent ("No test to add/prove
RED->GREEN: the removed function had zero test coverage to begin with").
`tsc --noEmit` and `eslint` on the touched file are clean; the file's existing
sibling test suites (`x-content-humanize.test.ts`, `x-content-schedule.test.ts`)
still pass (9/9) post-removal, confirming no hidden coupling.

### Note for the next sweep

While tracing this file's symbols, `X_ACCOUNT_USERNAME` (the line immediately above
the removed constant, same `// Brand` section) also appears to have zero remaining
consumers in `src/` — a repo-wide grep finds only its own declaration plus a mention
inside a comment in `src/lib/site.ts` ("`x` mirrors X_ACCOUNT_USERNAME in
x-content.ts"). Left untouched here to keep this PR single-issue; worth a dedicated
look (and a fresh git-blame trace, same discipline as above) in a future round.
