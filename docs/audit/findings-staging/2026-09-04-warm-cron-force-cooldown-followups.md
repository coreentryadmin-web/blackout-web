## 2026-09-04 — [FINDING, P3 Performance] meridian-warm and zerodte-warm carry the same missing force=1 cooldown as desk-warm/heatmap-warm — OPEN, follow-up only

> **kind:** `FINDING`

| Field | Value |
|---|---|
| **Status** | OPEN — write-up only, deliberately not fixed here (see below) |
| **Found by** | DISCOVERY lane, same pass that fixed `heatmap-warm` (PR #3542) |

### What was checked

`#3540` (desk-warm) and `#3542` (heatmap-warm, this session) both fixed the same shape: an
`OVERLAP_LOCK` (`sharedCacheSetNx`) that only blocks a SECOND run from starting while the FIRST is
still in flight, releasing the instant that run completes — which on an already-warm cache can be
well under a second — combined with `force=1` completely bypassing the hours gate and nothing else
capping replay rate. `#3540`'s blast-radius section named seven routes carrying this shape;
`heatmap-warm` was fixed in this pass as the tightest-cadence candidate.

Confirmed live (`grep` against current `main`) that two more of the named routes carry the
identical gap — `OVERLAP_LOCK` present, no `RERUN_COOLDOWN`:

- `src/app/api/cron/meridian-warm/route.ts` — `OVERLAP_LOCK_KEY = "meridian-warm:running"`,
  `OVERLAP_LOCK_TTL_SEC = 600`, no cooldown key. `RTH_WRITER_HEAL_AFTER_MIN["meridian-warm"] = 5`
  (5 min).
- `src/app/api/cron/zerodte-warm/route.ts` — `OVERLAP_LOCK_KEY = "zerodte-warm:running"`,
  `OVERLAP_LOCK_TTL_SEC = 900`, no cooldown key. `RTH_WRITER_HEAL_AFTER_MIN["zerodte-warm"] = 4`
  (4 min).

Both are looser-cadence than `desk-warm` (90s) and `heatmap-warm` (20s), so a replay-loop attack
is proportionally less damaging on these two than it was measured to be on the two already fixed —
which is exactly why they were not picked up in the same PR (this lane's own scope discipline:
one issue per branch/PR, and the tightest-cadence / highest-measured-impact candidate goes first).

`coaching-alerts`, `bie-full-state-snapshot`, `swing-active-refresh` and `nighthawk-playbook` (the
remaining four routes #3540 named) were not re-checked in this pass — `coaching-alerts` and
`bie-full-state-snapshot` do not use `shouldRunCacheWarmer`/the same hours-gate shape at all (spot
check above), so each needs its own read before assuming the identical fix applies verbatim.

### Why not fixed here

Same reasoning #3540 and #3542 both already state: mirroring the pattern is mechanical, but the
cooldown TTL has to be tuned to each cron's own measured cadence (heatmap-warm's 10s was derived
from its 20s heal threshold and 15s leader tick, not copied from desk-warm's 60s), and this lane's
own standing policy is one issue per branch/PR — bundling two more crons into the PR that just
fixed the first one would blur the regression test / evidence trail for both.

### Suggested next step

For `meridian-warm`: add a `RERUN_COOLDOWN_KEY = "meridian-warm:cooldown"` with a TTL safely below
5 min (e.g. 60-120s, matching desk-warm's proportion of ~2/3 its heal threshold). For
`zerodte-warm`: same shape, TTL safely below 4 min. Mirror `heatmap-warm/route.test.ts`'s test
structure (source-text assertions on ordering/key names + one behavioral test against the real
`sharedCacheSetNx` primitive). Each is its own single-issue PR per the standing policy.
