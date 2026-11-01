> **kind:** FINDING

## `vector-universe-snapshot` / `vector-bead-record` have no cross-replica overlap lock, unlike every sibling warm cron — measurement needed (no AWS creds this round), not fixed on a guess — OPEN, write-up only

**Status:** OPEN — write-up only, no code changed. This sandbox has no live AWS credentials this
round (`sts.get_caller_identity()` returns `InvalidClientTokenId`, the documented placeholder-creds
signature in CLAUDE.md's "Access reality" §3/3d) — the CloudWatch measurement this fix needs cannot
be taken from here. Documenting the exact measurement + decision procedure for whoever has creds,
rather than guessing either way. **Severity:** P3 (candidate) — potential wasted UW/Polygon-bound
fan-out contending with real member traffic on shared ECS compute, same shape as the
`desk-warm`/`vector-pick-sweep` overlap incidents already fixed elsewhere in this repo; NOT
escalated higher because, per CLAUDE.md's own standing performance mandate, a lock must be
justified by measured `elapsed=` data against the route's own schedule, not added on
pattern-matching alone. **Area:** `src/app/api/cron/vector-universe-snapshot/route.ts`,
`src/app/api/cron/vector-bead-record/route.ts`.

### What's wrong (the asymmetry)

Every other background-warm cron in `src/app/api/cron/` that dispatches heavy work via
`after()` guards against a second invocation starting while the first is still in flight, using
the same `sharedCacheSetNx` (Redis `SET NX EX`) idempotent-skip pattern:

```
$ grep -l "OVERLAP_LOCK_KEY" src/app/api/cron/*/route.ts
src/app/api/cron/desk-warm/route.ts
src/app/api/cron/heatmap-warm/route.ts
src/app/api/cron/meridian-warm/route.ts
src/app/api/cron/platform-warm/route.ts
src/app/api/cron/vector-dark-pool-warm/route.ts
src/app/api/cron/vector-full-state-snapshot/route.ts
src/app/api/cron/vector-pick-sweep/route.ts
src/app/api/cron/vector-walls-warm/route.ts
```

`vector-universe-snapshot/route.ts` and `vector-bead-record/route.ts` are **not** in that list —
read both files in full this round and confirmed neither imports `sharedCacheSetNx`/`sharedCacheDel`
at all, let alone uses them to guard `dispatchSnapshot`/`dispatchRecording`. Both dispatch their
real work via `after()` exactly like their locked siblings (`vector-universe-snapshot`'s own
comment: *"refreshVectorUniverseSnapshot + wall-history read-backs can exceed Cloudflare's ~100s
origin timeout when caches are cold... Mirror vector-full-state-snapshot: handshake in seconds,
recorder in after()"* — i.e. the route's own authors modeled it on a sibling that DOES have the
lock, without carrying the lock itself).

### Why this needs measurement, not a guess (per CLAUDE.md's performance mandate)

CLAUDE.md's standing performance/latency mandate is explicit: *"Measure before guessing... Check
EVERY cron's own schedule against its own measured `elapsed=` runtime before concluding it needs
an overlap guard"* — and gives a concrete negative example from the same incident that produced
`desk-warm`'s own lock: five sibling ~5-min-schedule crons at 30-91s runtime were correctly left
WITHOUT a lock because they weren't actually at risk; only `vector-pick-sweep` (301s runtime vs a
120s schedule) got one. Adding a lock to a cron that doesn't need one is explicitly called out as
scope creep, not a fix. So the right next step is the measurement, not the code change:

1. **Pull real `elapsed=` numbers from CloudWatch Logs** (`/ecs/blackout-production`) for
   `[cron/vector-universe-snapshot] background done` and
   `[cron/vector-bead-record] background done` — both routes already log their own elapsed time
   on success (confirmed reading the source: `vector-universe-snapshot`'s `console.info` line ends
   `elapsed=${Date.now() - started}ms`; `vector-bead-record`'s does the same).
2. **Compare against each route's own real trigger cadence**, not just its nominal schedule label:
   - `vector-universe-snapshot`: `cron-registry.ts` lists `schedule_label: "~Every 5 min (market
     hours)"`, `stale_after_min: 15`. It is **not** present in `rth-warm-leader-logic.ts`'s
     `RTH_WRITER_HEAL_AFTER_MIN` map (grepped — only `vector-bead-record` has an entry there), so
     its only real trigger source is the EventBridge 5-min schedule — a single, slower cadence
     than `desk-warm`'s dual EventBridge-+-90s-heal-loop setup that caused that route's overlap
     incident. If measured `elapsed=` stays well under ~300s (5 min), there is no real overlap risk
     and no lock is warranted, consistent with the mandate's own "don't add a lock that isn't
     needed" instruction.
   - `vector-bead-record`: `cron-registry.ts`'s own comment says *"No EventBridge rule is deployed
     for this route... the only real backup to the 5s in-app primary
     (vector-bead-recorder-leader.ts) is rth-warm-leader.ts's own in-process heal loop, which
     dispatches this route at a 10s threshold"* (`RTH_WRITER_HEAL_AFTER_MIN["vector-bead-record"]
     = 10/60`). A 10s re-dispatch floor is MUCH tighter than any other locked route's cadence (the
     next-tightest, `desk-warm`, heals at 90s) — if the real background work (recording wall-history
     samples for ~100 universe tickers plus all actively-viewed non-universe tickers, per the
     route's own `recordSharedUniverseWallSamples`/`recordActiveNonUniverseWallSamples` calls) ever
     takes anywhere close to 10s under a cold cache, this is the one case in this pair that looks
     genuinely at risk on the numbers already in the comments, before even pulling CloudWatch data.
     This is the stronger of the two candidates and should be measured first.
3. **Decide per-route from the data**: if measured runtime has real margin against the real trigger
   cadence (as the mandate's own worked example found for 5 of 6 sibling crons that round), leave it
   alone and note why in a follow-up correction to this entry. If margin is thin or negative (as it
   was for `vector-pick-sweep`), add the same `sharedCacheSetNx`/`sharedCacheDel` overlap-lock
   pattern already used by every sibling listed above — it is a known-good, already-reviewed
   pattern in this codebase, not a new design.

### Evidence

- `grep -l "OVERLAP_LOCK_KEY" src/app/api/cron/*/route.ts` (above) — 8 routes carry the lock,
  `vector-universe-snapshot` and `vector-bead-record` do not.
- Full read of both route files confirms no `sharedCacheSetNx`/`sharedCacheDel` import, no lock
  key, no overlap guard of any kind around their `after()`-dispatched background functions.
- `src/lib/rth-warm-leader-logic.ts` — `RTH_WRITER_HEAL_AFTER_MIN` map contains
  `"vector-bead-record": 10 / 60` (10 seconds) and no entry for `"vector-universe-snapshot"`.
- `src/lib/cron-registry.ts` — `vector-universe-snapshot`: `schedule_label: "~Every 5 min (market
  hours)"`, `stale_after_min: 15`; `vector-bead-record`: `schedule_label: "No EventBridge rule
  deployed — in-app leader backup only, 10s heal threshold"`, `stale_after_min: 1`.
- `python3 -m pip install boto3 -q && python3 -c "import boto3; boto3.client('sts',
  region_name='us-east-1').get_caller_identity()"` this round →
  `ClientError: An error occurred (InvalidClientTokenId) when calling the GetCallerIdentity
  operation: The security token included in the request is invalid.` — confirms this sandbox is on
  placeholder AWS creds this round (CLAUDE.md §3/3d's documented default state), so the CloudWatch
  pull in step 1 above cannot be done from here today.

### Blast radius

No code changed. If a lock is later added to one or both routes, the same `sharedCacheDel` cleanup
discipline every sibling uses (release in a `finally`, fail-open on a Redis error rather than
getting stuck) should be copied rather than reinvented — see `desk-warm/route.ts`'s own
`OVERLAP_LOCK_KEY`/`OVERLAP_LOCK_TTL_SEC` handling for the reference shape.

### Next step for whoever picks this up

Re-run with real AWS creds: pull `elapsed=` for both routes' `background done` log lines over a
representative RTH session, compare against the real cadences above (EventBridge 5-min for
universe-snapshot; 10s heal-loop for bead-record), and either (a) add the overlap lock to whichever
route(s) show thin/negative margin, with a regression test and the usual RED→GREEN proof, in a
normal single-issue PR, or (b) correct this entry to record "measured, no lock needed" the way
CLAUDE.md's own mandate did for the 5 sibling crons that turned out not to need one.
