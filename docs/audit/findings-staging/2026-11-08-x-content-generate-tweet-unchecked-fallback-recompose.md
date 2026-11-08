> **kind:** FINDING

# `generateTweetContent`'s give-up fallback recomposed the draft from scratch — the posted body was never dedup-checked, and the loop's own checked draft was thrown away

| | |
|---|---|
| **Area** | X autopost content generation — `src/lib/x-content.ts` (`generateTweetContent`) |
| **Severity** | P2 — defeats the near-duplicate guard precisely in the case it exists hardest to protect, and wastes an AI call every time it fires |
| **Status** | FIXED |

## Root cause

`generateTweetContent` retries up to 3 times, each time generating a draft via `anthropicText`,
composing it via `composeHumanTweet`, and checking the result against
`isTooSimilarToRecentPosts`. If all 3 attempts come back "too similar," the function falls back to
posting *something* AI-written rather than the generic template — but the fallback branch called
`composeHumanTweet(draftBody, …)` a **4th time**, on the stale `draftBody` string left over from the
loop's last iteration:

```ts
if (draftBody) {
  const composed = await composeHumanTweet(draftBody, { postType, spxPrice: data.spxPrice, regime: data.regime });
  return { content: attachFooter(composed.body, footer), draftBody: composed.draftBody, enhanced: composed.enhanced };
}
```

`composeHumanTweet` (`src/lib/x-content-humanize.ts`) is **not deterministic**: when the draft
sounds bot-like or is short, it calls `enhanceTweetDraft`, a real Claude call at
`temperature: 0.75`. So calling it twice on the exact same `draftBody` can produce two different
`body` strings. Concretely, this one bug had two separate real effects:

1. **Wasted AI spend.** The loop's own 3rd-attempt `composed` (which was already computed and
   already run through `isTooSimilarToRecentPosts`) was discarded unused; the fallback paid for a
   fresh `enhanceTweetDraft` call just to throw away the result that already existed.
2. **The dedup guard was silently bypassed on its own intended case.** The body that actually got
   returned (and posted) — the output of that 4th call — was **never** passed to
   `isTooSimilarToRecentPosts`. So in the exact scenario the retry loop exists for (repeated
   near-duplicate generations), the tweet that actually ships is an *unchecked* variant, not the
   checked-but-rejected one the loop just spent 3 rounds evaluating.

## Evidence (RED → GREEN)

New test `src/lib/x-content-generate-tweet.test.ts` mocks every direct import of `x-content.ts`
(`providers/anthropic`, `vector-snapshot`, `vector-regime`, `providers/gex-positioning`,
`x-content-humanize`, `x-whop-link`, `x-content-dedup`, `x-marketing-meta`, `x-analytics`,
`x-content-schedule` — all via relative `mock.module()` specifiers, matching the established
convention in `flow-gex-enrichment.test.ts`/`admin-gex-health.test.ts`; this also sidesteps
`x-content.ts`'s transitive `server-only` import chain the same way `x-content.test.ts`'s own
header documents it must). `composeHumanTweet` is mocked to return a distinguishable
`BODY_${callCount}` each call, and `isTooSimilarToRecentPosts` is mocked to always report
`similar: true`, forcing the give-up path on every run.

```
git stash   (pre-fix)
npx tsx --experimental-test-module-mocks --test src/lib/x-content-generate-tweet.test.ts
# composeHumanTweet must be called exactly once per retry attempt (3)...
# 4 !== 3   → FAIL

git stash pop   (post-fix)
# ok 1 - generateTweetContent reuses the last composed draft on give-up, never recomposes unchecked
# pass 1 / fail 0
```

Also ran the adjacent suite (`x-content.test.ts`, `x-content-humanize.test.ts`) and `tsc --noEmit`,
both clean post-fix.

## Blast radius

Only `generateTweetContent`'s single give-up branch. Its two callers
(`src/app/api/cron/x-autopost/route.ts`, `src/app/api/cron/x-intel/route.ts`) both already treat
the returned `{ content, draftBody, enhanced }` shape opaquely and need no change — the fix keeps
the exact same return shape, just sourced from the loop's last composed result instead of a fresh
recomposition.

## Fix rationale

Track the loop's `composed` result in an outer-scope `lastComposed` variable, updated right after
each `composeHumanTweet` call, and have the give-up fallback return `lastComposed` directly instead
of recomputing. This removes the wasted 4th AI call and guarantees the body that ships is always
the exact one that was (even if unsuccessfully) checked against `isTooSimilarToRecentPosts` — never
a fresh, unchecked variant. Left unchanged: the overall "give up after 3 attempts and post anyway
rather than the generic template" policy itself (that tradeoff is intentional and out of scope
here), the retry count (3), and every other call site/behavior in this file.
