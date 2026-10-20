> **kind:** FINDING

## `vector-pick-sweep`'s overlap-lock TTL was silently reverted 1500s→900s by PR #5975, re-opening the exact overlap bug #5912 fixed — FIXED

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, DISCOVERY-lane re-verification of older `FINDINGS.md` entries (surfaced while
checking a different, unrelated ALB tail-latency claim — this is a separate, newly-discovered issue
flagged in that same investigation, not a re-check of that entry itself).

**Root cause:** `src/app/api/cron/vector-pick-sweep/route.ts`'s `OVERLAP_LOCK_TTL_SEC` went
480→900 (2026-09-03, real measured worst-case 694s) →1500 (PR #5912, 2026-10-12, real measured
worst-case 1036.5s, with `cron-registry.ts`'s `stale_after_min` raised 15→25 in lockstep per both
PRs' own stated intent) → **900 again** (PR #5975, 2026-10-13) — the last step with no commit-message
mention of touching this constant at all; #5975's stated purpose was adding a *cross-cron*
concurrency guard (`heavy-cron-concurrency-guard.ts`), and it edited the exact same code region
(the comment block + `const` + the `finally` block) that #5912 had just changed, silently
dropping #5912's raise back to the pre-#5912 value in the process — almost certainly a branch/merge
artifact (editing a region without rebasing onto the immediately-prior change to that same region),
not an intentional re-tuning. `route.test.ts`'s own two TTL-margin tests moved in lockstep with the
constant (#5975 reverted both the `OVERLAP_LOCK_TTL_SEC = 1500` assertion back to `= 900` and the
`1037s` margin check back to `694s`), so nothing in that file's own test suite could catch the
revert — every test in the file still passed against the reverted value, because the test and the
code it guards reverted together. The only place the correct value remained recorded was
`cron-registry.ts`'s `stale_after_min: 25` for this cron's key, which #5975 never touched.

**Live impact:** real, measured — PR #5912's own CloudWatch evidence (2026-10-12, 12:40-15:25 UTC
RTH-open) showed sweeps running 992393ms and 1036542ms, both above the reverted 900s TTL, with
reconstructed timestamps confirming genuine cascading overlap (a sweep's lock expiring mid-run,
letting the next scheduled fire start a second concurrent sweep, which itself overlapped a third).
With the TTL back at 900s, the next RTH-open spike of this shape re-opens that exact overlap —
two sweeps contending for the same cluster-wide Polygon/UW rate limiters real member requests also
depend on, the mechanism #5912 (and #5975's own sibling guard) were both built to prevent.

**Fix:** restored `OVERLAP_LOCK_TTL_SEC` to `1500`, restored the comment block explaining the
2026-10-12 raise (kept alongside #5975's own cross-cron-concurrency comment, unchanged), and
restored both `route.test.ts` assertions to their correct 1500s/1037s values. Added a new
regression test, `"the lock TTL stays in lockstep with this cron's own stale_after_min in
cron-registry.ts"`, that cross-checks `route.ts`'s TTL against `cron-registry.ts`'s
`stale_after_min` directly — this is the test that actually catches this class of silent revert,
since the two existing tests (both internal to `route.ts`) provably cannot: they moved with the
constant during the #5975 revert and reported green throughout.

**Blast radius:** single cron (`vector-pick-sweep`). `heavy-cron-concurrency-guard.ts`'s own
comment (line ~43, "vector-pick-sweep measured up to ~900s") undersells the real worst case by
~137s but makes no numeric claim this fix contradicts (it's a rough aside about typical slot
occupancy, not a tuned constant) — left unchanged rather than widening this PR's scope; worth a
follow-up glance but not itself broken. No other cron's TTL/`stale_after_min` pair was touched by
#5975's diff (confirmed via `git show c5b6329ae` — the other 5 routes it edited only gained the new
cross-cron-concurrency call, no TTL constant changes), so this is believed to be the only instance.

**Test:** `src/app/api/cron/vector-pick-sweep/route.test.ts` — 2 existing tests corrected, 1 new
cross-file regression test added. RED→GREEN proven via `git stash` on `route.ts` alone (3/9 fail
against the reverted 900s value; 9/9 pass restored). Full file + sibling
`heavy-cron-concurrency-guard.test.ts` run clean (9/9 + 11/11). Repo-wide `npx tsc --noEmit` clean.
