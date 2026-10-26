> **kind:** FINDING

## `scripts/seo/syndicate-articles.mjs` — `--limit=0` silently posted one article anyway — FIXED

| | |
|---|---|
| **Status** | Fixed |
| **File** | `scripts/seo/syndicate-articles.mjs` |
| **Severity** | P3 (narrow — only on a manual `workflow_dispatch` with that exact flag) |
| **Found** | 2026-10-26, round 120 discovery sweep, follow-up flagged by round 119 |

### Root cause

`main()`'s limit parsing used the classic falsy-fallback bug:

```js
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 1;
```

`0` is falsy in JavaScript, so `Number("0") || 1` evaluates to `1`. An operator who deliberately
passes `--limit=0` on a manual trigger (e.g. to pause posting for one run without touching the
schedule itself) got `limit = 1` instead — the script posted exactly one article, the opposite of
what `--limit=0` is supposed to mean. This sits in the exact same file PR #6920 (round 119) fixed a
different, more severe bug in (fail-open duplicate-posting on a fetch failure); this is an
independent, narrower issue in the CLI arg parsing, not a re-touch of that fix.

### Evidence

New test `parseLimitArg honors an explicit --limit=0 (operator pause) instead of falling back to 1`
in `scripts/seo/syndicate-articles.test.ts`. RED→GREEN proof via `git stash`:
- With the fix stashed out (old inline expression restored), the two new `parseLimitArg` tests
  fail: `parseLimitArg is not a function` (pre-fix, the helper didn't exist as a separable, testable
  unit at all — the logic was buried inline in `main()`).
- With the fix restored, all 12 tests in the file pass, including:
  - `parseLimitArg(["--limit=0"])` → `0` (not `1`).
  - `pickToSyndicate(arts, new Set(), parseLimitArg(["--limit=0"]))` → `[]` (actually limits
    selection to nothing, not just that the parsed number reads as 0 in isolation).
  - Fallback still correctly applies for a missing flag, an unparseable value (`--limit=abc`), and
    a present-but-empty value (`--limit=` with nothing after `=`).
  - A normal positive `--limit=5` still parses to `5`.

### Blast radius

Single call site — `main()`'s own `const limit = ...` line is the only place this parsing happened.
`pickToSyndicate(articles, alreadyPostedCanonicals, limit)` itself was already correct (`.slice(0,
0)` legitimately returns `[]`); the bug was entirely upstream, in never actually producing a `0` to
pass it.

### Fix rationale

Extracted the parsing into a small, exported, independently-testable `parseLimitArg(args,
defaultLimit = 1)` function, replacing the inline `||`-based fallback with an explicit
`Number.isFinite(n) ? n : defaultLimit` check — this only falls back when the flag is absent, has no
value after `=`, or doesn't parse to a finite number, never on a legitimately-parsed `0`. Negative
limits are deliberately left out of scope: `Number("-1")` was already truthy under the old code (so
a negative limit already passed through unchanged before this fix), and `pickToSyndicate`'s own
`.slice(0, limit)` behavior on a negative limit is a separate, pre-existing question not raised by
this finding.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
