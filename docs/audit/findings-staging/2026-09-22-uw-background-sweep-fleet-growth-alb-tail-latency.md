> **kind:** FINDING

## The 2026-09-03 UW background-sweep concurrency reservation no longer absorbs current cron-fleet load — ALB tail latency has returned to pre-fix severity — OPEN

| | |
|---|---|
| **Area** | `src/lib/providers/uw-rate-limiter.ts` (`runWithBackgroundUwSweep`, `GLOBAL_MAX_CONCURRENCY`) and every cron tagged with it (16 routes under `src/app/api/cron/*`) |
| **Severity** | P2 — no errors/crashes, but a measured, recurring live-member-facing latency regression (ALB `TargetResponseTime` p99/Max) that tracks a documented prior incident's exact symptom shape re-appearing at the same severity |
| **Status** | OPEN — root cause traced to fleet growth outrunning a capacity assumption, but the two candidate fixes both need information/judgment this sandbox cannot safely supply (see "Why no fix shipped" below) |
| **Found via** | Standing performance/latency audit mandate — live CloudWatch sweep, 2026-09-22 ~18:00-20:10 UTC |

### Evidence

`AWS/ApplicationELB TargetResponseTime` on `blackout-production-app` target group, 3-hour window
ending 2026-09-22 20:11 UTC, 5-minute buckets — every bucket shown had `Max > 1s`:

```
18:18 p99=11.01 max=94.60  reqs=283 5xx=2
18:23 p99=48.61 max=100.66 reqs=425 5xx=1
18:48 p99=88.79 max=101.40 reqs=193 5xx=1
19:18 p99=17.58 max=111.47 reqs=192 5xx=1
19:28 p99=99.78 max=108.52 reqs=242 5xx=1
20:03 p99=4.09  max=107.82 reqs=345 5xx=1
20:08 p99=50.62 max=99.02  reqs=266 5xx=1
```
(full 23-bucket window: every bucket had `max` between 11s and 111s; `p99` swung 4-100s bucket to
bucket — a classic tail-latency shape, not a uniformly-slow fleet: `AWS/ECS CPUUtilization` on
`blackout-production-web` read **avg 24.3% / max 99.0%** over the same window — low fleet average,
individual-task saturation spikes, exactly the shape this file's own performance mandate says to
treat as "one saturating background job," not capacity.)

`elapsed=` from `/ecs/blackout-production` CloudWatch Logs, same ~2h window, grouped by cron
(`[cron/<name>] background done ... elapsed=<ms>`):

```
cron                        n   min(ms)  max(ms)   median(ms)
bie-full-state-snapshot     22  1039     85352     41923
desk-warm                    1  48714    48714     48714
swing-active-refresh         8  17363    91294     64077
uw-cache-refresh             53 5375     48530     20670
vector-dark-pool-warm        5  186707   265401    226203
vector-full-state-snapshot  18  62725    210160    106510
vector-universe-snapshot    21  2154     80178     10219
zerodte-warm                16  6093     401202    14162
```

Eight distinct crons, all independently tagged `runWithBackgroundUwSweep`, ran concurrently and
repeatedly inside the same 2-hour window — several with individual runs exceeding 200-400 seconds.
UW `[api-queue-timing]`/`[uw] queue wait` log lines from the same window confirm real admission
contention: `queue_wait_ms` values of 3963, 5739, 10060, 14215, 15242 recorded on live SPX
spot-exposures/option-chain/darkpool reads inside a single ~30-second slice.

### Root cause

`uw-rate-limiter.ts`'s own header comment documents the exact same symptom, measured 2026-09-03:
ALB `Max ~115-119s`, `p99 11-39s`, "repeatedly, across 8+ separate 5-minute windows in one RTH
session" — root-caused then to `vector-full-state-snapshot`, `vector-dark-pool-warm`,
`bie-full-state-snapshot` and `vector-pick-sweep` (four crons) each holding the shared
`GLOBAL_MAX_CONCURRENCY` ceiling (env `UW_GLOBAL_MAX_CONCURRENCY`, defaults to **2**) for 90-286s
per run with no overlap, starving live member UW reads. The fix (`runWithBackgroundUwSweep`)
reserves at least one slot for live traffic by having a background-tagged caller compare its own
admission against `ceiling - 1` (floor 1) instead of the full ceiling.

That fix is still correctly wired (verified live: all 16 crons that call into UW-backed
warm/refresh paths carry the tag — `bie-full-state-snapshot`, `darkpool-discord`,
`data-correctness`, `desk-warm`, `flow-ingest`, `meridian-warm`, `nighthawk-edition`,
`platform-warm`, `swing-active-refresh`, `swing-discovery`, `uw-cache-refresh`,
`vector-dark-pool-warm`, `vector-full-state-snapshot`, `vector-pick-sweep`,
`vector-universe-snapshot`, `zerodte-warm`). But the fix's capacity assumption was sized against
**four** concurrently-overlapping crons in 2026-09-03's evidence; today's live evidence shows
**eight** distinct crons overlapping in the same window, several running 3-7x longer than that
incident's own worst individual runtimes (`zerodte-warm` 401202ms here vs the 2026-09-03 note's
worst cited figure of 286328ms for `vector-dark-pool-warm`). With `GLOBAL_MAX_CONCURRENCY` still
at its 2026-09-03 default of 2, reserving `ceiling - 1` still leaves only **1** slot for ALL live
member UW-touching requests combined whenever ANY background sweep is in flight — and with 8 crons
now regularly overlapping instead of the 4 the fix was tuned against, at least one background sweep
is essentially always in flight during RTH, so live traffic is now competing for that single
remaining slot far more often than the fix's original design point assumed. This reproduces the
pre-fix ALB symptom almost exactly (Max 94-111s vs the pre-fix incident's 115-119s; p99 up to
99.78s vs the pre-fix 11-39s — actually *worse* on the p99 axis) even though the fix itself has not
regressed or been reverted — the fleet simply grew past what it was sized for.

### Why no fix shipped in this PR

Two candidate fixes exist and both need information/judgment this sandbox cannot supply safely:

1. **Raise `UW_GLOBAL_MAX_CONCURRENCY`/`UW_GLOBAL_MAX_RPS` above 2.** This is a live third-party
   API's actual admission ceiling — raising it without knowing Unusual Whales' real contracted
   rate/concurrency limit risks tripping UW's own throttling or violating a plan limit, which would
   be a strictly worse outcome (provider-side 429s/bans) than the current self-inflicted queueing.
   No source in this repo documents UW's actual plan ceiling; guessing a new number here is exactly
   the "fix from a guess when the metric is one API call away" anti-pattern this file's own
   performance-mandate section warns against — except here the metric (UW's real limit) is NOT one
   API call away from this sandbox.
2. **Stagger the 16 crons' EventBridge schedules** so fewer of them fan out inside the UW rate
   limiter simultaneously (the same hourly-offset pattern this file's own "5-engine live monitor"
   trigger set already uses for audit cadence). This is lower-risk but requires editing
   `blackout-infra` (a separate repo) cron schedule definitions and re-deriving each cron's real
   runtime distribution to pick non-colliding offsets — a genuine design task, not a one-line patch,
   and out of scope for a same-cycle fix without that additional measurement pass.

### Recommended next step

Re-run this same CloudWatch/log sweep during a *different* RTH session to confirm this is a
persistent pattern rather than a one-day anomaly (today's session had 8 concurrent crons purely
from normal scheduling — no unusual event), then either (a) confirm UW's actual plan concurrency
ceiling with the operator before touching `UW_GLOBAL_MAX_CONCURRENCY`, or (b) build a cron-schedule
staggering pass in `blackout-infra` sized against the 8-cron reality measured here rather than the
4-cron figure the 2026-09-03 fix was tuned against. Raised on the standing #4076 Claude↔Cursor
collaboration thread per the TEAM CAPACITY RULE — this is exactly the kind of cross-layer
(backend rate-limiter + infra cron-schedule) investigation suited to a split.
