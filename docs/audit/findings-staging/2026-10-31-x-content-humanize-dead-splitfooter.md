# 2026-10-31 x-content-humanize.ts: dead-on-arrival splitContentWithFooter/stripFooter pair

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 code-quality / dead code |

## Root cause

`src/lib/x-content-humanize.ts` exported `splitContentWithFooter`, which wrapped a
module-private helper `stripFooter`:

```ts
function stripFooter(text: string): { body: string; footer: string | null } {
  const idx = text.lastIndexOf("\n@");
  if (idx === -1) return { body: text.trim(), footer: null };
  return { body: text.slice(0, idx).trim(), footer: text.slice(idx + 1).trim() };
}
...
export function splitContentWithFooter(full: string): {
  body: string;
  footerLine: string;
} {
  const { body, footer } = stripFooter(full);
  return { body, footerLine: footer ?? "" };
}
```

Both were added in the same commit as `attachFooter` — #848 / `900cc47df` ("human voice pipeline +
no @tag timeline spam", 2026-07-20) — clearly intended as `attachFooter`'s inverse: `attachFooter`
glues a `@handle` footer line onto a tweet body before posting, and `splitContentWithFooter` would
presumably split it back apart somewhere downstream (a cleanup script, a re-parse of a stored post,
etc.).

That downstream caller was never written. `attachFooter` is wired into two real call sites in
`src/lib/x-content.ts` (building the post content before it ships); `splitContentWithFooter` has
had **zero call sites anywhere in the repo from the moment it was introduced**. `git log --all
-S"splitContentWithFooter"` returns only the introducing commit (`900cc47df`, later squash-merged
as `3050a335d` / #848) — no later commit ever added, then removed, a caller. `stripFooter` is not
exported and was only ever called by `splitContentWithFooter`, so it was equally dead the whole
time, just invisible to a repo-wide-reference grep because it's module-private.

This is the same shape as `countOwnMentionPostsTodayEt` (fixed earlier this cycle) and the broader
class of same-vintage X/social helpers built ahead of a consumer that was never written — scoped
out from the owned-lane X/social dead-code candidate list for round 163.

## Evidence

Repo-wide grep, both symbols, before the fix:

```
$ grep -rn "splitContentWithFooter" src/ --include="*.ts" --include="*.tsx"
src/lib/x-content-humanize.ts:156:export function splitContentWithFooter(full: string): {
```

Only the definition — no caller, not even in the file's own test (`x-content-humanize.test.ts`
only imports `soundsLikeBot`/`deterministicHumanize`). After removal, a repo-wide grep (excluding
`node_modules`) for either symbol across `*.ts`/`*.tsx`/`*.mjs`/`*.js` returns zero matches.

RED→GREEN proof via `git stash` on the source file alone (test added first):

- **RED** (pre-fix source restored via stash): `does not re-export the dead footer-splitting pair
  (splitContentWithFooter/stripFooter)` fails — `"splitContentWithFooter" in xContentHumanize` is
  `true`.
- **GREEN** (fix restored): same test passes; `attachFooter` is still exported and the two
  existing tests (`soundsLikeBot`, `deterministicHumanize`) still pass unchanged.

## Blast radius

- `stripFooter` (module-private) was only ever called by `splitContentWithFooter` — removing the
  latter made the former dead too, so both are removed together.
- `attachFooter` — the function that **is** wired in — is untouched; its two call sites in
  `src/lib/x-content.ts` (`src/lib/x-content.ts:207`, `:222`) are unaffected.
- No other file imports `splitContentWithFooter` or `stripFooter`; sibling test
  `src/lib/x-content.test.ts` still passes.

## Fix rationale

Straight deletion of both functions — no behavior to preserve, nothing to migrate a caller onto,
since there never was a caller. Extended the existing `x-content-humanize.test.ts` with a
regression test asserting the module's exported surface no longer includes
`splitContentWithFooter` (while still including `attachFooter`), so a future accidental re-add
without a real wired-in caller fails CI rather than silently reappearing as unused code.

## Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/x-content-humanize.test.ts
  src/lib/x-content.test.ts` — 5/5 pass (Node 20).
- `npx tsc --noEmit` — clean.
- `npx eslint src/lib/x-content-humanize.ts src/lib/x-content-humanize.test.ts` — clean.
- Rebased cleanly onto `origin/main` post-#7032 merge; re-ran the full verification above against
  the rebased tip.
