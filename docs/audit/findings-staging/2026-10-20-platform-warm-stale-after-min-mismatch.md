> **kind:** FINDING

## `platform-warm`'s overlap-lock TTL and `cron-registry.ts`'s `stale_after_min` disagreed since the guard was added — FIXED

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, DISCOVERY-lane follow-up sweep after fixing the `vector-pick-sweep` TTL
silent-revert this same cycle — a background Explore-agent checked every other cron route's
overlap-lock TTL against `cron-registry.ts`'s `stale_after_min` for the exact same bug class.

**Root cause:** `src/app/api/cron/platform-warm/route.ts`'s overlap-lock guard was added in PR
#5984 (2026-10-14) with a comment stating `"TTL (600s) matches this cron's own stale_after_min:
10 safety-net ceiling"` and `const OVERLAP_LOCK_TTL_SEC = 600`. But `src/lib/cron-registry.ts`'s
real `platform-warm` entry has always had `stale_after_min: 15`, not 10 — the comment's claimed
number was never true for this cron. Traced to a copy-paste: #5984's own diff shows the comment
and `sharedCacheSetNx` pattern were lifted from `meridian-warm` ("Same `sharedCacheSetNx`
deduplication pattern as meridian-warm guards this"), whose registry entry genuinely has
`stale_after_min: 10` — the "10" carried over without checking platform-warm's own registry
value. Unlike the `vector-pick-sweep` case (a value that was once correct and later silently
reverted), this one was never correct — a documentation/invariant-drift bug present from the
guard's introduction, not a regression.

**Why `10`, not `15`, is the fix:** `platform-warm` shares its exact job family with `desk-warm`
and `meridian-warm` — same `"~Every 5 min (extended warm window)"` schedule label, same
`shouldRunCacheWarmer` gate, same "pre-warm general platform cache" shape — and both of those
true siblings have `stale_after_min: 10` in the registry. `platform-warm`'s own `15` reads as the
outlier within its own job family, not the TTL. Correcting the registry to `10` (matching the
already-functioning `600s` TTL and its real siblings) is the conservative fix — raising the TTL to
`900s` instead would invent a new, unmeasured ceiling with no supporting evidence, unlike
`vector-pick-sweep`'s `1500s` raise which was backed by real CloudWatch worst-case data.

**Live impact:** low on its own (a 5-minute gap in the staleness-alert window for a cache-warming
cron, not an active overlap bug — the TTL and the actual lock behavior were never wrong, only the
registry's alerting threshold), but the same documentation-correctness issue this doc map's own
drift findings this cycle have flagged: a false "lockstep" claim that an engineer reading the
comment would trust without checking.

**Fix:** corrected `cron-registry.ts`'s `platform-warm` entry to `stale_after_min: 10`. Added a new
regression test to `route.test.ts` (platform-warm previously had **zero** test coverage on the TTL
value, internal or cross-file) that cross-checks `route.ts`'s `OVERLAP_LOCK_TTL_SEC` against
`cron-registry.ts`'s `stale_after_min` directly — the same pattern added to `vector-pick-sweep`
this cycle, now covering a second cron.

**Blast radius:** single cron, registry-only change plus a new test. Confirmed via grep that
`admin-cron-health.test.ts`'s own `"platform-warm"` reference is an independent synthetic test
fixture (`jobDef({...})`, only importing the `CronJobDefinition` type, never `CRON_JOBS` itself) —
unaffected by this change.

**Test:** `src/app/api/cron/platform-warm/route.test.ts` — new cross-file regression test. RED→GREEN
proven via `git stash` on `cron-registry.ts` alone (1/4 fails against the pre-fix `stale_after_min:
15`; 4/4 pass restored). Full file + `admin-cron-health.test.ts` run clean (18/18 combined).
Repo-wide `npx tsc --noEmit` clean.
