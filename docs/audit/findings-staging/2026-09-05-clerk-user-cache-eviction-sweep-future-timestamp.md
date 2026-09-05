# Clerk user-cache eviction sweep future-timestamp guard — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-2026-09-05-clerk-user-cache-eviction-sweep-freshness |
| **Priority** | P2 |
| **Status** | FIXED |
| **Area** | Freshness guards |

## Symptom

#3915 fixed the read path (`getClerkUserCached`'s `hit && isWsUpdatedAtFresh(hit.at, DEDUPE_TTL_MS)`)
but left `setResolved`'s size-pressure eviction sweep on the same raw arithmetic:
`if (now - v.at >= DEDUPE_TTL_MS) resolved.delete(k)`. A far-future/clock-skewed `v.at` yields a
negative age that never satisfies `>= DEDUPE_TTL_MS`, so the sweep never evicts that entry — it
only leaves the map via the `MAX_RESOLVED` oldest-key fallback. Same bug class as #3912/#3915/#3760,
different call site in the same file.

Two independent parallel PRs (#3917, #3918) had already found and fixed this exact gap, but both
were closed in favor of #3915 (which merged without the eviction-sweep hunk) — this PR ports that
already-reviewed fix back in as a small, focused follow-up.

## Fix

Route the eviction sweep through the same shared `isWsUpdatedAtFresh(v.at, DEDUPE_TTL_MS, now)`
helper already used on the read path.

## Evidence

- `src/lib/clerk-user-cache-freshness.test.ts` — extended with a second assertion; RED (1/2 fail)
  on the unfixed source, GREEN (2/2 pass) after the fix (git-stash verified).
- `npx tsc --noEmit` clean.

## Blast radius

`clerk-user-cache.ts` only, and only the `MAX_RESOLVED` size-pressure path (2,000-entry in-process
Clerk `getUser` dedupe map) — no behavior change for normal-path lookups, already fixed in #3915.
