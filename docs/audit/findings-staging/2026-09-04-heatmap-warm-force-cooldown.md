## 2026-09-04 — [FINDING, P2 Performance] heatmap-warm's `force=1` was the same unthrottled-replay gap as desk-warm (#3540) — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Priority** | P2 performance |
| **Surface** | `src/app/api/cron/heatmap-warm/route.ts` |
| **Status** | FIXED |

### Root cause

`heatmap-warm` (the shared GEX matrix pre-warmer for the Thermal/Vector/Largo shared ≤100-ticker
universe) already had a cross-replica `OVERLAP_LOCK` (`sharedCacheSetNx`), but that lock only
guards against a SECOND run starting while the FIRST is still in flight — it is released the
instant the run completes. On an already-warm universe the route's own header comment says
"warm names are Redis-cache-first (near-free)", so a completed run can finish far faster than the
p50=46.5s measured for a cold sweep. `force=1` completely bypasses `shouldRunCacheWarmer`'s hours
gate (documented as open to any `CRON_SECRET` holder for on-demand/debug warms), and nothing
capped how often it could be replayed. This is the exact same structural gap #3540 found and
fixed on `desk-warm` — flagged in that PR's own blast-radius section as also present on
`heatmap-warm`, `meridian-warm`, `zerodte-warm`, `coaching-alerts`, `bie-full-state-snapshot`,
`swing-active-refresh`, and `nighthawk-playbook`.

`heatmap-warm` is the tightest-cadence candidate in that list: `RTH_WRITER_HEAL_AFTER_MIN
["heatmap-warm"]` is 20s — the tightest heal threshold of any watched key in
`rth-warm-leader-logic.ts` (desk-warm's is 90s, meridian-warm's is 5min) — and the in-app leader's
own tick loop runs every 15s. A replay loop tighter than the leader's own cadence could re-trigger
the full shared-universe Polygon fan-out (and the SSE delta broadcast to every live Heat Maps
subscriber) far faster than any legitimate trigger ever does.

### Fix

Same pattern as #3540, tuned to this cron's own cadence: a `RERUN_COOLDOWN_KEY` ("heatmap-warm
cooldown") claimed via the same atomic `sharedCacheSetNx` primitive, checked BEFORE the overlap
lock and before the warm pass runs, with a 10s TTL — safely below the 20s heal threshold and the
15s leader tick, so no legitimate trigger (EventBridge's own ~30-45s schedule included) can ever
observe it. Unlike `OVERLAP_LOCK`, the cooldown key is never deleted early — it persists for its
full TTL so the floor holds regardless of how fast an individual run finishes. Fails OPEN on a
Redis error, same posture as `OVERLAP_LOCK`, so a Redis blip can't wedge the cron shut.

### Blast radius

Scoped to `heatmap-warm` only. The other six routes #3540 named (`meridian-warm`, `zerodte-warm`,
`coaching-alerts`, `bie-full-state-snapshot`, `swing-active-refresh`, `nighthawk-playbook`) were
checked in this pass and confirmed to carry the same missing-cooldown shape (verified live:
`meridian-warm` and `zerodte-warm` both have `OVERLAP_LOCK` with no `RERUN_COOLDOWN`, same as
`heatmap-warm` had) — left as follow-up findings for a future single-issue PR each, per this
lane's own scope discipline (one issue per branch/PR).

### Fix rationale

Mirrored #3540's exact pattern (atomic NX claim, checked before the overlap lock, TTL-persisted
rather than early-released, fail-open on Redis error) rather than inventing a new shape, so the
two crons stay recognizably the same fix under review. The 10s TTL (vs desk-warm's 60s) is the
one deliberate difference, sized to this cron's own much tighter 20s heal threshold rather than
copying desk-warm's number verbatim.

### Regression guard

`src/app/api/cron/heatmap-warm/route.test.ts` — 7 tests (2 new): the cooldown constant/key exist
and are correctly named, the claim is atomic and ordered before the overlap lock and before the
warm pass, the skip response returns before running the warm pass, the claim fails open on a
Redis error, the key is never deleted early, and a behavioral test against the real
`sharedCacheSetNx` primitive proves a second claim inside the TTL is genuinely refused (not just
asserted via source-text regex). Proven RED pre-fix / GREEN post-fix via `git stash`.

### Gates

`npx tsc --noEmit` clean · `npx tsx --test src/app/api/cron/heatmap-warm/route.test.ts` 7/7 pass
(Node 20.20.2).
