> **kind:** FINDING

# `isTimelinePostAllowed` only scanned line 1 — an @mention past line 1 reached the timeline uncaught

| | |
|---|---|
| **Area** | X autopost / feed policy (`src/lib/x-feed-policy.ts`) |
| **Severity** | P2 — violates the brand's own standing policy ("NEVER @tag other accounts on @BlackOutTrade profile") with a real, demonstrable call path, not a theoretical one |
| **Status** | FIXED — PR open |

## Root cause

`isTimelinePostAllowed(text)` was written to look at exactly one line:

```ts
const firstLine = (text.split("\n")[0] ?? text).trim();
if (/^@\w/.test(firstLine)) return false;
if (/(?:^|\s)@\w{2,}/.test(firstLine) && !firstLine.includes("@BlackOutTrade")) {
  return false;
}
```

The design assumption was that the AI-written tweet **body** is always a single line, and the
trusted Whop footer (which legitimately self-tags `@BlackOutTrade`, e.g.
`@BlackOutTrade · link in bio`) is always appended afterward as its own, separate, LAST line —
so checking only line 1 was believed to be equivalent to checking the whole body while still
tolerating the footer's self-tag.

That assumption does not hold. Nothing in the generation pipeline enforces a single-line body:

- `generateTweetContent` (`src/lib/x-content.ts`) gets `draftBody` straight from
  `anthropicText(...)`, trimmed only at the ends (`raw?.trim()`), never stripped of internal
  newlines.
- `composeHumanTweet`/`enhanceTweetDraft` (`src/lib/x-content-humanize.ts`) run the body through
  `trimBody`/`truncateText`, which truncate by character count, not by line — an embedded `\n`
  survives untouched.
- `attachFooter` (`src/lib/x-content-humanize.ts`) then does `${body}\n${footer}`, so the final
  tweet text can legitimately have 2+ body lines followed by the footer line.

So a real, reachable shape for the final tweet text is:

```
Good read on SPX today.
Shoutout @randomtrader for the free tip!
@BlackOutTrade · link in bio
```

`isTimelinePostAllowed` only ever inspected `"Good read on SPX today."` (line 1). The
`@randomtrader` mention on line 2 — exactly the "spam @tag pattern" this function exists to
block — was never looked at, on any of its real call sites:

- `src/lib/x-api.ts` `postTweet`/`postQuoteTweet` — called on the FULL final text (body + footer).
- `src/lib/x-post-guard.ts` `isTweetContentValid` — same, called on the full text.
- `src/lib/x-content-humanize.ts` `enhanceTweetDraft` — called on the enhanced body alone, before
  the footer is attached, so a multi-line enhanced body has the identical gap one step earlier.

This closes the specific open question CLAUDE.md's round-220 prompt flagged from a prior round:
*"x-feed-policy.ts's isTimelinePostAllowed first-line-only scope ... no demonstrable live path
where a multi-line AI body reaches it — if round 220's x-autopost read finds a caller that DOES
produce multi-line content, revisit this specific question."* Reading `x-autopost/route.ts` this
round traced the exact call (`postTweet(content)` where `content = attachFooter(composed.body,
footer)`) and confirmed `composed.body` has no newline-stripping anywhere upstream of it — the
live path exists.

## Evidence (RED → GREEN)

Pre-fix, this returns `true` (should be `false` — it contains an @mention of another account):

```
isTimelinePostAllowed(
  "Good read on SPX today.\nShoutout @randomtrader for the free tip!\n@BlackOutTrade · link in bio",
)
```

Added as a regression test in `src/lib/x-feed-policy.test.ts`. `git stash` of just the fix
reproduces the failure (1 of 3 subtests failing); with the fix applied, all pass (3/3), plus the
two pre-existing tests and the new "still allows a normal multi-line desk post whose only mention
is the self-tag footer" case, so the fix does not regress the footer's own self-tag exemption.

```
npx tsx --experimental-test-module-mocks --test src/lib/x-feed-policy.test.ts
# pre-fix:  2 pass / 1 fail
# post-fix: 3 pass / 0 fail
```

Also ran the full adjacent-file suite (`x-feed-policy`, `x-content-humanize`, `x-post-guard`,
`x-api`, `x-desk-card` test files — 18 tests) and `tsc --noEmit` clean, both post-fix.

## Blast radius

Every caller of `isTimelinePostAllowed` benefits from the same fix with no code change needed at
the call site: `x-api.ts` (`postTweet`, `postQuoteTweet`), `x-post-guard.ts`
(`isTweetContentValid`), and `x-content-humanize.ts` (`enhanceTweetDraft`'s own pre-footer check).

## Fix rationale

Scan every line (not just line 1) for an @mention that isn't the account's own self-tag, while
still rejecting a text that literally *starts* with "@" on line 1 only (unchanged from before —
that specific check is about a post reading like a reply, and the self-tag never legitimately
opens line 1). The existing `!line.includes("@BlackOutTrade")` exemption is preserved per-line, so
the trusted footer line (which always carries that self-tag) is unaffected and both pre-existing
tests still pass unchanged.

Deliberately left unchanged: the footer format itself (`x-whop-link.ts`), the AI prompts telling
the model "NEVER @tag other accounts" (prompt-level instructions are not enforcement and this fix
doesn't rely on the model obeying them), and the single-line-check shape of the "starts with @"
reply-detection rule (scoped to line 1 only is correct for that specific check, since the
self-tag is never the opening line of a real desk post).
