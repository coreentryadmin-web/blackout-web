# 2026-10-31 x-api.ts: `countOwnMentionPostsTodayEt` dead-on-arrival since outreach was removed, never deleted

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 code-quality / dead-code removal (confirmed zero behavior change) |

## Root cause

`src/lib/x-api.ts` is the raw X (Twitter) API client (OAuth 1.0a signing, tweet/media/follow/like
calls) used by the whole `x-*` marketing/growth lane (autopost, engage, growth, analytics,
intel). It exported `countOwnMentionPostsTodayEt()` — "count how many `@`-prefixed posts the
account made today, ET" — originally added in commit `421623610` (`feat(x-growth): max
engagement — 30min sweeps, viral @mentions, reply-all`, 2026-07-20) to support an "@mention
outreach" feature that posted original `@username` tweets as a growth tactic.

That outreach feature was removed the same day in commit `3050a335d` (`fix(x-marketing): human
voice pipeline + no @tag timeline spam`, #848) — the commit that **deleted
`src/lib/x-engage-mentions.ts` outright** (37 lines removed) and added `isTimelinePostAllowed()`
(`x-feed-policy.ts`) specifically to **block** `@`-prefixed posts going forward
(`postTweet()` now throws `"Timeline post rejected: do not @tag other accounts..."` for any text
starting with `@`). The function's own doc comment was updated in step with that removal to read
`/** @mention outreach posts today (legacy counter — outreach removed from timeline). */` — the
author correctly flagged it as legacy at the time, but never deleted the function itself.

It has had **zero call sites anywhere in the repository since 2026-07-20** (confirmed with a
repo-wide grep across `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs`, including the test tree — there is no
`x-api.test.ts` referencing it, and no test file existed for `x-api.ts` at all before this fix).
`git log --all --oneline -S"countOwnMentionPostsTodayEt"` returns only the four commits from that
single 2026-07-20 day (add → two @BlackOutTrade-quality-gate commits that didn't touch it →
the comment update marking it legacy); `x-api.ts` has been touched twice since (2026-09-05, an
unrelated Polygon null-handling fix) with no further reference. The feature it served
(`@mention` outreach posts) is now actively **prevented** at the `postTweet()` layer, so even if
something called this counter today, the number it would report (outreach posts made) describes
a code path that can no longer execute — the function is not just unused, it measures something
structurally impossible now.

This is the same dead-on-arrival-after-feature-removal shape as the `getSubscriberCount`/
`clearSubscribers` finding in `gex-matrix-broadcast.ts` (2026-10-31, same round), but here the
removal is self-documented in the function's own comment rather than needing a git-archaeology
trace to establish intent — the author's own words ("outreach removed from timeline") are the
confirmation that this was meant to go away with the feature, not scaffolding for later use.

The live replacement counter, `countOwnPostsTodayEt()` (no "Mention" in the name, line 479 of the
pre-fix file), is a different function entirely — it counts ALL of today's posts for the active
posting-cadence guard in `x-post-guard.ts` and is unaffected by this change.

## Evidence

- Repo-wide grep for `countOwnMentionPostsTodayEt` before the fix matches only its own
  `export async function` line in `src/lib/x-api.ts` — no import, no call, no test reference
  anywhere else in the tree (including `scripts/`).
- `git log --all --oneline -S"countOwnMentionPostsTodayEt" -- src` returns exactly the four
  2026-07-20 commits that introduced, surrounded, and then relabeled it as legacy — no later
  commit ever adds a caller.
- `git show 3050a335d -- src/lib/x-engage-mentions.ts` confirms the module this counter supported
  (`x-engage-mentions.ts`) was deleted in its entirety the same day the comment was updated to
  "legacy."
- Zero-reference proof stands in for a RED→GREEN stash proof here (per the dead-code removal
  discipline): there is no caller-observable behavior to regress, because no caller exists.

## Blast radius

None beyond the function itself. `fetchUserTweets` and `X_ACCOUNT_USER_ID` — the two helpers this
function called — remain exported and are used by `x-post-guard.ts`, `x-engage-engine.ts`,
`x-content-dedup.ts`, `x-analytics.ts`, and `x-api.ts`'s own other exports, all unchanged.
Re-grepped post-fix: every surviving caller of `fetchUserTweets`/`X_ACCOUNT_USER_ID` is untouched.

## Fix

Removed the unused `countOwnMentionPostsTodayEt` export and its doc comment (the last 14 lines of
the file). No other code in `x-api.ts` changed.

Also added `src/lib/x-api.test.ts` — this module previously had **no test file at all** despite
being the live posting/engagement client for `@BlackOutTrade`. The new tests cover the one pure,
env-driven surface (`xApiEnabled()` under all-present / one-missing / blank-but-present credential
combinations, restoring the real env afterward) plus the two identity constants
(`X_ACCOUNT_USER_ID`, `X_BLOCK_RT_USERNAMES`). The rest of the module's exports make real
`https://api.x.com` HTTP calls and are exercised indirectly by their callers' own test suites
(`x-post-guard.test.ts`, `x-engage-engine.test.ts`, `admin-x-analytics.test.ts` — all re-run below
and still green), so this fix gives the surviving code some real regression coverage rather than
leaving the change as a pure subtraction with nothing added back.

## Verify

- `npx tsx --experimental-test-module-mocks --test src/lib/x-api.test.ts` — 4/4 green (new file).
- `npx tsx --experimental-test-module-mocks --test src/lib/x-engage-engine.test.ts` — 3/3 green
  (unaffected caller).
- `npx tsx --experimental-test-module-mocks --test src/lib/x-post-guard.test.ts` — 2/2 green
  (unaffected caller).
- `npx tsx --experimental-test-module-mocks --test src/lib/admin-x-analytics.test.ts` — 1/1 green
  (unaffected caller).
- `npx tsc --noEmit` — clean.
- `npx eslint src/lib/x-api.ts src/lib/x-api.test.ts` — clean.
