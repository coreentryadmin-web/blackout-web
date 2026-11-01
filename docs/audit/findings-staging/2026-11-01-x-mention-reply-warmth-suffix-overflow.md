> **kind:** FINDING

## `pickMentionReply` could produce a reply up to 290 chars — 10 over X's 280 limit — FIXED

| | |
|---|---|
| **Area** | X marketing / mention-reply engine (`src/lib/x-engage-replies.ts`) |
| **Severity** | P3 (quality/correctness; no live API break due to a downstream safety net — see Blast Radius) |
| **Status** | Fixed |

### Root cause

`pickMentionReply` decides whether to append a warm closer sentence to a mention reply
by checking a flat length budget:

```ts
if (base.length <= 240) {
  return `${base} Always good to connect with traders in the space.`;
}
```

The closer string (`" Always good to connect with traders in the space."`) is **50**
characters, not the ≤40 the `240` threshold implicitly assumed (X's hard limit is 280,
so the budget needed to be `280 - 50 = 230`). Any `base` reply in the range
`[231, 240]` chars therefore passed the `<= 240` check and produced a combined reply of
up to `240 + 50 = 290` characters — 10 over the platform's per-tweet limit.

Confirmed directly against the shipped function (not inferred): sweeping synthetic
username lengths, `username = "a".repeat(140)` (a 140-char handle) with
`mentionText = "0dte gamma flip question"` produced a `base` of exactly 231 chars and a
`pickMentionReply` result of **281 chars**; the overflow band extended through
username length 149 (base 240 chars → reply 290 chars). Below and above that band the
function behaved correctly (either the closer fit, or the `base.length > 240` branch's
`slice(0, 279)` fallback kicked in).

### Evidence

RED (original code, `base.length <= 240`):
```
not ok 2 - never exceeds the 280-char tweet limit across the base-length range that triggers the closer
  error: 'pickMentionReply produced 281 chars for username length 140: ...'
```

GREEN (fixed code, `base.length + MENTION_WARMTH_SUFFIX.length <= TWEET_CHAR_LIMIT`):
```
ok 2 - never exceeds the 280-char tweet limit across the base-length range that triggers the closer
# tests 6
# pass 6
# fail 0
```
Full `src/lib/x-*.test.ts` suite (69 tests, 17 suites) passes after the fix. `tsc --noEmit`
clean.

### Blast radius

- **Only call site**: `src/lib/x-mention-replies.ts`'s `craftMentionReply` falls back to
  `pickMentionReply` only when the AI-generated reply (`anthropicText`) is unavailable or
  out of its own `[20, 260]` length band, and `runMentionReplySweep` always
  `.slice(0, 280)`s the final text immediately before `postReply(...)` — so this bug never
  broke the live X API call (a crossed-280 string from `pickMentionReply` would be
  silently truncated there, same as any other overlong text would be). The real-world
  symptom was narrower and purely cosmetic: for mention texts/usernames landing a `base`
  reply in the 231-240 char band, the posted tweet lost its trailing word(s)/period to a
  mid-sentence truncation instead of cleanly omitting the closer sentence altogether (the
  function's own existing fallback for "too long to add the closer").
- `pickEngagementReply` / `pickEngagementQuote` (same file) were not affected — they have
  no closer-append logic.
- No other caller of `pickMentionReply` exists in the repo.

### Fix rationale

Replaced the bare `240` magic number with a derived budget
(`base.length + MENTION_WARMTH_SUFFIX.length <= TWEET_CHAR_LIMIT`, where
`TWEET_CHAR_LIMIT = 280`) so the check can never drift out of sync with the actual
closer text again — if the closer copy is ever edited, the budget recalculates
automatically instead of needing a second manual edit to a magic number (the same
drift shape as the sibling `config.ts`/`deskPulseStructureCacheTtlMs` finding this
sweep's method already caught once this round). Kept the existing `slice(0,
TWEET_CHAR_LIMIT - 1)` (279-char) fallback behavior unchanged for the "even the base is
too long" case — deliberately not widened to 280, since that fallback already existed
and changing its exact cap was out of scope for this fix.

### Regression test

`src/lib/x-engage-replies.test.ts` — new `describe("pickMentionReply", ...)` block:
1. Appends the closer cleanly when it fits, and stays ≤280.
2. Sweeps username lengths 1-260 and asserts every `pickMentionReply` result is ≤280
   chars (reproduces the exact overflow band against the pre-fix code; RED→GREEN
   verified by `git stash`-ing the fix and re-running).
3. Confirms the "too long for the closer" fallback still returns a clean 279-char slice
   with no partial closer text.
