> **kind:** FINDING

## `x-autopost` route's `trimToLimit` was a fifth un-migrated copy of the `truncate-text.ts` ellipsis bug, plus an unconditional-ellipsis bug of its own — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (cosmetic, member/public-facing — live product marketing posts on X) |
| **Area** | `src/app/api/cron/x-autopost/route.ts` → extracted to `src/lib/x-autopost-trim.ts` |

### Root cause

`src/lib/truncate-text.ts`'s own header documents consolidating THREE duplicated copies
of the same truncation bug (`headlineFromMarkdown`, `x-content-humanize`,
`generic-extract`): slicing text to a length budget, calling `.trimEnd()`, and appending
an ellipsis — which only strips trailing *whitespace*, never trailing punctuation, so a
cut landing right after a sentence's own full stop (or a comma/colon/dash) ships as
`…resistance.…` instead of `…resistance…`. PR #7642 (this same session) found and fixed a
**fourth** un-migrated copy in `conversation-history.ts`'s `conversationTitle()`.

This is a **fifth**. `x-autopost/route.ts`'s `trimToLimit` (used to shorten a generated
desk tweet down to X's 280-char limit before posting) had the exact same shape:

```ts
function trimToLimit(content: string, postType: PostType): string {
  const footer = `\n${xPostFooterLine(postType)}`;
  const maxBody = 280 - footer.length - 1;
  if (content.length <= 280) return content;
  const body = content.slice(0, content.lastIndexOf("\n"));
  return body.slice(0, maxBody).trimEnd() + "…" + footer;
}
```

It carries **two** real defects, both reachable on live, scheduled marketing posts:

1. **Double punctuation before the ellipsis** — identical to the four prior copies:
   `body.slice(0, maxBody).trimEnd()` only removes trailing whitespace, so a hard cut
   that lands right after real sentence punctuation ships that punctuation glued
   directly onto the ellipsis (`...resistance.…`). `isTweetContentValid`'s
   `BROKEN_PATTERNS` list (`src/lib/x-post-guard.ts`) has no entry that matches this
   shape, so nothing downstream catches it before posting.
2. **Unconditional ellipsis, even when nothing was cut** — `content` here is
   `body + "\n" + <old footer line>`; the function strips the footer line
   (`content.slice(0, content.lastIndexOf("\n"))`) and operates on the body alone. If
   `content.length > 280` *only* because of that trailing footer line, the stripped
   body can already be well under `maxBody` with no truncation needed at all — yet the
   old code appended `"…"` regardless, every time, mangling an otherwise-complete,
   already-short sentence with a trailing ellipsis it never earned.

Neither defect is hypothetical for this file specifically: `generateTweetContent`
(`src/lib/x-content.ts`) always returns `content` as `${draftBody}\n${footer}`, so
`trimToLimit` runs on every post whose body-plus-footer exceeds 280 chars, which is a
normal, frequent case for this cron (`src/app/api/cron/x-autopost/route.ts`), not an edge
case.

### Evidence (RED → GREEN)

New test file `src/lib/x-autopost-trim.test.ts`, 3 cases:

1. A sanity check (`oldTrimForRegressionOnly`, the literal pre-fix logic kept inline for
   this one assertion) reproducing the double-punctuation bug on an engineered input
   (a run of `.` characters straddling both candidate cut boundaries) — passes,
   confirming the input actually exercises the bug shape.
2. `trimToLimit` (fixed) on the same input never produces `/[.,;:]…/` and still includes
   an ellipsis (truncation genuinely occurred).
3. `trimToLimit` on a short body whose `content` only exceeds 280 chars because of its
   own stale trailing footer line: the fixed body is returned with **no** ellipsis.

Reverting the fix (`return truncateText(body, maxBody) + footer;` back to
`return body.slice(0, maxBody).trimEnd() + "…" + footer;`) via a scripted patch and
re-running the suite reproduced the exact failures expected:

```
not ok 2 - trimToLimit (fixed) never glues trailing punctuation onto the ellipsis
  error: 'result still glues punctuation onto the ellipsis: "...AAA.....…\n@BlackOutTrade · link in bio"'
not ok 3 - trimToLimit does not append a spurious ellipsis when the stripped body already fits
  error: 'did not expect an ellipsis when no truncation was needed: "...close.…\n@BlackOutTrade · link in bio"'
```

Restoring the fix returns the suite to 3/3 green. `npx tsc --noEmit` clean on both
touched files and the whole project.

### Blast radius

Single call site — `trimToLimit` is only used by `x-autopost/route.ts`'s `GET` handler,
right before the generated content is validated (`isTweetContentValid`) and posted live
via `postTweet`/`tweetWithImage`. No other file duplicates this exact slice-then-append
pattern for X posts (checked: `x-engage-replies.ts` uses a plain `.slice(0, 280)` with no
ellipsis logic at all, out of scope here and not exhibiting this bug shape).

### Fix rationale

Rather than hand-patching the same three-line bug a sixth time somewhere else later,
`trimToLimit` now delegates the actual truncation to the already-shared, already-tested
`truncateText()` (`src/lib/truncate-text.ts`), which strips trailing punctuation before
appending the ellipsis, only appends the ellipsis when truncation actually occurred, and
backs up to a word boundary (a improvement this file never had at all — the old code did
a bare hard cut with no word-boundary awareness).

`trimToLimit` itself was moved out of `route.ts` into a new pure module,
`src/lib/x-autopost-trim.ts` (logic unchanged beyond the one-line fix), because
`route.ts`'s import graph pulls in `server-only`-guarded modules that `node:test` cannot
load standalone — there was no way to unit-test the function in place. `route.ts` now
just imports it; `trimToLimit`'s signature, inputs and outputs are unchanged, so this is
a pure extraction plus the one-line fix, not a behavior change beyond the two bugs
described above.

Deliberately left unchanged: the surrounding footer-stripping logic
(`content.slice(0, content.lastIndexOf("\n"))`) and the `maxBody` budget formula — both
are correct as written and out of scope for this fix.
