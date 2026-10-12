## 2026-10-12 — [FINDING, P2 performance, Vector] `vector-pick-sweep`'s overlap-lock TTL (900s) undershot a new measured worst-case runtime (1036.5s), letting a second sweep start while the first was still in flight — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| `vector-pick-sweep` cron (`src/app/api/cron/vector-pick-sweep/route.ts`) | P2 — recurrence of an already-fixed overlap mechanism at a new, higher peak, contributing to shared Polygon/UW rate-limiter contention | FIXED |

**What's wrong.** Standing performance/latency audit pass, CloudWatch `/ecs/blackout-production`
`elapsed=` filter, 12:40-15:25 UTC (RTH open). `vector-pick-sweep` logged two runs above its own
`OVERLAP_LOCK_TTL_SEC = 900` (raised from 480s to 900s on 2026-09-03 for the identical reason):
`elapsed=992393ms` (14:13:19→14:29:51) and `elapsed=1036542ms` (14:35:18→14:52:34). Reconstructing
every run's start time as `finish_timestamp - elapsed_ms` (not just reading `elapsed=` in isolation)
confirmed this was not merely "at risk" but genuinely overlapping:

- The 992.4s run's lock (900s TTL) expired ~14:28:19, 93s before it actually finished at 14:29:51.
  A scheduled fire at 14:29:18 acquired the now-free lock and started a second sweep while the first
  was still running (confirmed: second sweep's own "done" line logs `elapsed=234818ms`, i.e. it
  started while the first was mid-run and finished 33s before the first did).
- A third sweep (started 14:31:18, elapsed=320433ms) overlapped the second the same way.
- The 1036.5s run (started 14:35:18) overlapped a fourth sweep (started 14:37:18, elapsed=928437ms)
  for nearly its entire 15-minute runtime — the two "done" lines are timestamped 14:52:34.997 and
  14:52:46.941, 12 seconds apart, confirming both were genuinely in flight concurrently almost the
  whole time.

This is the exact mechanism the 2026-09-03 fix (PR referenced in `FINDINGS.md`, 480s→900s) targeted
and partially resolved — a sweep outliving its own lock lets the next EventBridge fire (every 2 min
during RTH, `schedule_cron_utc: "1-59/2 11-21 * * 1-5"`) acquire the freed lock and start a second,
fully concurrent sweep. It has now recurred at a new peak (1036.5s vs the 2026-09-03 worst of 694s),
consistent with this being an RTH-open-specific spike in the shared cluster-wide Polygon/UW
rate-limiter contention every other elevated cron in the same window also showed (`zerodte-warm` up
to 410s, `vector-full-state-snapshot` up to 253.8s, `vector-dark-pool-warm` up to 201.8s,
`bie-full-state-snapshot` up to 153.9s, `meridian-warm` up to 101.3s — all already-documented
cross-cutting contention, not a new root cause on their own) — every run after 14:53 UTC that same
morning was back to a normal 60-180s range, so this was a transient ~40-minute escalation, not a
sustained regression.

**Fix.** Raised `OVERLAP_LOCK_TTL_SEC` from 900 to 1500 (25 min) — real margin above the new worst
observed 1036.5s, proportionally similar to the ~1.3x margin the 2026-09-03 fix used (900/694).
Raised the matching `stale_after_min` for `vector-pick-sweep` in `cron-registry.ts` from 15 to 25 to
keep the two in lockstep, per the route file's own stated intent. Did not touch the sweep's own
per-ticker work, the rate limiter, the schedule interval, or the overlap-guard mechanism itself
(`sharedCacheSetNx`/fail-open/release-in-`finally`) — only the TTL constant that had again fallen
behind real measured runtime changed, same scope discipline as the 2026-09-03 fix.

**Blast radius.** `src/app/api/cron/vector-pick-sweep/route.ts` and its own `stale_after_min` entry
in `src/lib/cron-registry.ts` only. No other route reads `vector:pick-sweep:running`. Checked every
other cron's own numbers in the same 3-hour window against its own schedule/TTL — none of the other
elevated crons listed above (`zerodte-warm`, `vector-full-state-snapshot`, `vector-dark-pool-warm`,
`bie-full-state-snapshot`, `meridian-warm`) exceeded its own overlap-lock TTL or stale_after_min
threshold in this window, so none needed a change; raising a TTL on a cron that isn't actually at
risk would be scope creep per this repo's own standing anti-scope-creep discipline.

**Regression guard.** `src/app/api/cron/vector-pick-sweep/route.test.ts`: updated the two existing
TTL-specific tests (`the lock TTL matches the cron's own stale_after_min safety net` and `the lock
TTL has real margin above the worst measured sweep runtime`) to assert 1500s and the new 1037s
floor, so the next undershoot past today's measured peak is caught the same way this one was.
Verified RED→GREEN via `git stash` (stashing the fix leaves 2 of 7 tests failing on the stale 900s
assertion; popping restores 7/7).

**Verification.** `npx tsc --noEmit` clean (Node 20.20.2). `npx tsx --experimental-test-module-mocks
--test src/app/api/cron/vector-pick-sweep/route.test.ts` — 7/7 pass.
