> **kind:** FINDING

## `X_ACCOUNT_USERNAME` was an orphaned constant whose value had drifted into two separate hardcoded literals — FIXED

**Status:** Fixed, regression tests added (`src/lib/x-content.test.ts`, extended `src/lib/x-whop-link.test.ts`).

### Root cause

`src/lib/x-content.ts` has declared

```ts
export const X_ACCOUNT_USERNAME = "BlackOutTrade";
```

since PR #849 (2026-07-20), but by the end of that SAME commit it had zero
consumers: the commit also deleted the one thing that used it
(`const TAG = \`@${X_ACCOUNT_USERNAME}\`;`, used by the now-removed
`xPostFooter()`) and replaced it with a new `xPostFooterLine()` in
`src/lib/x-whop-link.ts` that **re-hardcoded the literal** instead of
importing the constant:

```ts
// x-whop-link.ts, before this fix
return `@BlackOutTrade ${url}`;
...
return "@BlackOutTrade · link in bio";
```

Separately, PR #915 (2026-07-22, "feat(footer): add the @BlackOutTrade X
handle") added `SITE.social.x.handle` to `src/lib/site.ts`, with a comment
explicitly saying it "mirrors `X_ACCOUNT_USERNAME` in x-content.ts" — but
again hardcoded the value instead of importing it:

```ts
// site.ts, before this fix
x: { handle: "BlackOutTrade", url: "https://x.com/BlackOutTrade" },
```

So by the time this was found, the desk's X handle existed as **three
independent hardcoded occurrences of the same string** (`x-content.ts`'s dead
constant, `x-whop-link.ts`'s footer builder, `site.ts`'s `SITE.social.x`),
none of which imported from another, with a comment on the `site.ts` one
asserting a "mirrors" relationship that was never actually wired up. Verified
by git history (`git log --all -S"X_ACCOUNT_USERNAME"`) and a repo-wide grep
confirming zero non-comment references to the exported constant anywhere
outside its own declaration.

This is the same class of defect as the `GA4_PENDING_SIGNUP_KEY` wiring-drift
fix (PR #7007): an exported constant that looks safe to delete as dead code
actually names a value duplicated elsewhere, and the right fix is to make the
duplicate import the constant, not delete the constant.

### Evidence

```
$ grep -rn "X_ACCOUNT_USERNAME" src/ --include=*.ts --include=*.tsx | grep -v "x-content.ts:83"
src/lib/site.ts:9:  /** Social / community handles. `x` mirrors X_ACCOUNT_USERNAME in x-content.ts
```
— the only hit outside the declaration itself is the comment describing a
relationship that doesn't exist in code.

```
$ git log --all --oneline -S "X_ACCOUNT_USERNAME" -- src/lib/x-content.ts
cd3b224bf feat(x-marketing): autonomous stack with rate-budget guardrails (#849)
d84f7e2ee fix(x-marketing): @BlackOutTrade quality gates + engagement crons (#847)
```
— `git show cd3b224bf -- src/lib/x-content.ts` shows the exact diff that
removed `const TAG = \`@${X_ACCOUNT_USERNAME}\`;` and `xPostFooter()` in the
same commit that introduced `xPostFooterLine()` (now in `x-whop-link.ts`)
with the literal re-hardcoded.

### Blast radius

Two files duplicated the value, both fixed here:
- `src/lib/x-content.ts` — `X_ACCOUNT_USERNAME` now derives from
  `SITE.social.x.handle` instead of standing alone; `BRAND_VOICE` (the system
  prompt for the autopost AI) now interpolates `X_ACCOUNT_USERNAME` at its two
  call sites instead of repeating the literal, giving the constant a real
  in-file consumer.
- `src/lib/x-whop-link.ts` — `xPostFooterLine()`'s two hardcoded
  `"@BlackOutTrade"` literals replaced with a module-level `ACCOUNT_TAG`
  derived from `SITE.social.x.handle`.
- `src/lib/site.ts` — updated the stale/backwards comment (it said `x`
  "mirrors" `X_ACCOUNT_USERNAME"`; after this fix the dependency direction is
  the other way around — `SITE.social.x.handle` is now the single source of
  truth both other files import from).

**Deliberately NOT touched** (out of scope for this fix — different call
sites using the literal for different reasons, not mirroring
`X_ACCOUNT_USERNAME`'s original role as the shared tag constant):
`src/lib/x-feed-policy.ts`, `src/lib/x-engage-config.ts` (search-query
literals), `src/lib/x-mention-replies.ts`, `src/lib/x-content-humanize.ts`,
`src/lib/largo/*.ts` (AI prompt/doc text), `src/components/admin/AdminXMarketingPanel.tsx`
(UI label). All still contain their own `"@BlackOutTrade"` / `"BlackOutTrade"`
literals; a broader sweep to wire all of them to `SITE.social.x.handle` is a
separate, larger-blast-radius change better done on its own.

### Fix rationale

`SITE.social.x.handle` was chosen as the single source of truth over
`X_ACCOUNT_USERNAME` because `site.ts` has zero internal imports (it's a pure
data module used widely, including by `page-metadata.ts`'s `TWITTER_SITE`,
which already derives from `SITE.social.x.handle`), while `x-content.ts` pulls
in a heavy, `server-only`-guarded provider chain
(`anthropic.ts` → … → `gex-positioning.ts`). Making `x-whop-link.ts` import
`X_ACCOUNT_USERNAME` from `x-content.ts` instead would have (a) created a
circular import — `x-content.ts` already imports `xPostFooterLine` from
`x-whop-link.ts` — and (b) pulled the heavy provider chain into a file that
currently has none. Routing both through `SITE` avoids both problems.

Also explains why the regression test for `x-content.ts` reads its source as
text (`readFileSync`) instead of importing the module directly, the same
pattern already used by `src/lib/cron-dispatch.test.ts`: importing
`x-content.ts` under plain `node:test` throws
`Error: This module cannot be imported from a Client Component module. It
should only be used from a Server Component.` (the `server-only` package,
pulled in transitively through `gex-positioning.ts`), confirmed live while
building this fix.

### Regression tests

- `src/lib/x-content.test.ts` (new) — asserts `X_ACCOUNT_USERNAME` is wired to
  `SITE.social.x.handle` (not a literal) and that `BRAND_VOICE` interpolates
  the constant rather than re-hardcoding `@BlackOutTrade`.
- `src/lib/x-whop-link.test.ts` (extended) — a runtime assertion that the
  footer's handle tracks `SITE.social.x.handle`, plus a source-text assertion
  that there's no re-hardcoded `"@BlackOutTrade"` literal left (the runtime
  assertion alone can't distinguish "wired to SITE" from "coincidentally the
  same literal," since both evaluate to the same string today).

RED→GREEN proven via `git stash` on `src/lib/x-content.ts` +
`src/lib/x-whop-link.ts` alone (tests unchanged): 3 of 7 tests failed with the
fix stashed, all 7 passed with it restored.
