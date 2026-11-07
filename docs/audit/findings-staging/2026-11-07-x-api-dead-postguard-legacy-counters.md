# 2026-11-07 x-api.ts/x-post-guard.ts: `countOwnPostsTodayEt`/`minutesSinceLastOwnPost` left as dead, pre-fix duplicates after #7387

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 code-quality / dead-code removal (confirmed zero behavior change) |

## Root cause

`#7387` (2026-11-01, "quote-tweets silently count as desk product posts in checkPostGuard")
fixed a real counting bug in `src/lib/x-post-guard.ts`'s posting-cadence guard: the daily-cap
and minimum-spacing checks used to call `countOwnPostsTodayEt`/`minutesSinceLastOwnPost` —
generic "all of today's own tweets" counters imported straight from `src/lib/x-api.ts` — and
excluded growth-engagement activity from those counts with a single heuristic
(`text.trim().startsWith("@")`), which missed a quote-tweet (`pickEngagementQuote` deliberately
strips the leading `@handle`). The fix introduced two NEW, correctly-filtering functions local to
`x-post-guard.ts` — `countOwnProductPostsTodayEt`/`minutesSinceLastProductPost` — built on a
shared `isGrowthEngagementTweet` predicate that also checks `referenced_tweets` for a `"quoted"`
reference, and rewired `checkPostGuard` to call the new pair instead of the old `x-api.ts` ones.

That rewiring is correct and complete for `checkPostGuard` itself. But the OLD pair —
`countOwnPostsTodayEt`/`minutesSinceLastOwnPost` in `x-api.ts`, which still carry the pre-fix
counting behavior (no quote-tweet exclusion at all, not even the old `@`-prefix heuristic) —
was left in place and re-exported from `x-post-guard.ts` under the comment `// Legacy export for
tests`. That comment is no longer true: a repo-wide grep (including `scripts/`, `.mjs`, `.cjs`)
finds **zero** callers of either function anywhere except their own definition in `x-api.ts` and
the pass-through re-export in `x-post-guard.ts` — no test file references them, and no other
production code imports them. This is the exact "sibling of an already-fixed function left
behind, uncorrected and now just dead" shape the CLAUDE.md "sibling" pattern names, except here
the sibling wasn't missed during the fix (the fix correctly built its *own* replacement
functions) — it was simply never deleted, and the misleading "for tests" comment makes a future
reader likely to assume it's still exercised and safe to resurrect/call, which would reintroduce
the exact quote-tweet-miscount bug #7387 just fixed, under a different name.

This is the same file/shape as two earlier dead-code removals in this exact lane:
`#7046` (removed unused `postThread`) and `#7036`
(removed unused `countOwnMentionPostsTodayEt`, which left behind the same "legacy counter, never
deleted" footprint after an earlier feature removal). `countOwnPostsTodayEt` was in fact the
function the 2026-10-31 `countOwnMentionPostsTodayEt` finding explicitly called out as "the live
replacement counter... unaffected by this change" — true at the time (checkPostGuard still used
it then), made false two days later by #7387's refactor.

## Evidence

- Repo-wide grep for `countOwnPostsTodayEt` and `minutesSinceLastOwnPost` (`.ts`/`.tsx`/`.mjs`/
  `.cjs`, excluding `node_modules`) before this fix matches only: their `export async function`
  definitions in `src/lib/x-api.ts`, and the `import`/re-`export` lines in
  `src/lib/x-post-guard.ts`. No call site, no test reference, anywhere.
- `checkPostGuard` (the only real consumer of a posting-cadence counter) already calls
  `countOwnProductPostsTodayEt`/`minutesSinceLastProductPost` exclusively — confirmed by reading
  its body; the old pair is not referenced there.
- Zero-reference proof stands in for a RED→GREEN stash proof here (same discipline the 2026-10-31
  dead-counter finding used): there is no caller-observable behavior to regress, because no
  caller exists.
- Post-fix: `npx tsc --noEmit` clean; `npx eslint src/lib/x-api.ts src/lib/x-post-guard.ts` clean;
  `npx tsx --experimental-test-module-mocks --test src/lib/x-api.test.ts src/lib/x-post-guard.test.ts
  src/lib/x-engage-engine.test.ts src/lib/admin-x-analytics.test.ts` — 19/19 pass (all four
  unaffected-caller suites still green); full `npm test` run clean (see PR for exact counts).

## Blast radius

None beyond the two functions and the now-unused `minutesSinceIso` import in `x-api.ts` (its only
caller was `minutesSinceLastOwnPost`). `fetchUserTweets`, `X_ACCOUNT_USER_ID`, and every other
`x-api.ts` export remain untouched and are used exactly as before by `x-post-guard.ts`,
`x-engage-engine.ts`, `x-content-dedup.ts`, `x-analytics.ts`, and others.

## Fix

Removed `countOwnPostsTodayEt`/`minutesSinceLastOwnPost` from `src/lib/x-api.ts` (and the now-dead
`minutesSinceIso` import there), and removed the dead import + `// Legacy export for tests`
re-export block from `src/lib/x-post-guard.ts`. `checkPostGuard` and every other export in both
files are unchanged.

## Verify

- `npx tsc --noEmit` — clean.
- `npx eslint src/lib/x-api.ts src/lib/x-post-guard.ts` — clean.
- `npx tsx --experimental-test-module-mocks --test src/lib/x-api.test.ts src/lib/x-post-guard.test.ts src/lib/x-engage-engine.test.ts src/lib/admin-x-analytics.test.ts` — 19/19 green.
- Full `npm test` — see PR for the exact pass count.
