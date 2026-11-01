> **kind:** FINDING

## heatmap-warm's per-ticker delta-snapshot TTL (120s) was under-provisioned against its own measured worst-case run cadence — FIXED

| | |
|---|---|
| **File** | `src/app/api/cron/heatmap-warm/route.ts` |
| **Status** | FIXED |
| **PR** | fix/heatmap-warm-snapshot-ttl |

### Root cause

`runHeatmapWarm` stores a per-ticker `gex-matrix-snapshot:<ticker>` cache entry after each warm
pass so the *next* run's `calculateMatrixDelta(previousSnapshot, currentSnapshot)` has something
to diff against (that diff is what actually feeds the SSE delta broadcast — see the file's own
"DELTA BROADCAST" header section). The TTL on that entry was a bare literal:

```ts
const snapshotTtlSec = 120; // 2 minutes; cron fires ~every 30-45s
```

The justifying comment ("cron fires ~every 30-45s") is the exact same stale cadence claim the
file's own header comment at the top of the file was already corrected to retract on 2026-10-08
("`~30-45s cadence` (this comment's old claim) was never actually achieved — corrected
2026-10-08"), with real measured numbers right there in the `OVERLAP_LOCK_TTL_SEC` doc comment
a few lines above this literal: p50=46.5s, p90=81.1s, p99=181.1s, max=209.2s (48h live CloudWatch
sample, n=1000 runs, 2026-09-03). The header fix evidently missed this second, independent copy
of the same stale claim sitting right next to it.

Fixing only the comment text would have left the TTL itself genuinely miscalibrated, not just
mis-documented. `OVERLAP_LOCK_KEY` serializes every run (no two ever overlap — a second
EventBridge tick arriving mid-run is skipped outright, see the lock-acquire branch), and
EventBridge's own deployed schedule only fires once a minute. So when a run takes longer than a
multiple of 60s, the *next actual run start* is pushed out to the next 60s-aligned tick after the
slow run releases the lock — at the measured max (209.2s), that's `ceil(209.2 / 60) * 60 = 240s`
before the next run even starts, and the snapshot has to survive from roughly where a ticker was
written in the slow run to where that same ticker is read again as "previous" in the next one.
120s does not cover that gap.

The failure mode is not a crash or an error: `calculateMatrixDelta` has an explicit early return —
`if (!previous) return null;` (`src/lib/gex-matrix-delta.ts`) — so an expired/missing previous
snapshot just silently skips the delta broadcast for that ticker that cycle (`deltasBroadcast`
isn't incremented, no warning is logged). That's exactly the kind of "measured zero conflated
with absence" shape this sweep keeps looking for: a quiet feature regression with no error
signal, concentrated on precisely the slow/congested runs (market-open volatility, upstream
Polygon slowness) where a fresher real-time delta matters most to the UI it feeds.

### Evidence (RED → GREEN)

Added a regression test (`route.test.ts`) asserting (1) the old under-provisioned
`snapshotTtlSec = 120` literal is gone, (2) the snapshot TTL is tied to the already-measured
`OVERLAP_LOCK_TTL_SEC` (240s) via a named constant rather than left as an independent guess, and
(3) the store call actually uses that constant.

- **RED** (pre-fix `route.ts`, via `git stash` isolating only that file): test 9 failed —
  `AssertionError: the old under-provisioned literal TTL (justified by the stale '~30-45s'
  cadence comment) must be gone`.
- **GREEN** (post-fix): `npx tsx --experimental-test-module-mocks --test
  src/app/api/cron/heatmap-warm/route.test.ts` → `# pass 10, # fail 0`.
- `npx tsc --noEmit` on the file's project: clean, no new type errors.

### Blast radius

Single call site — `GEX_MATRIX_SNAPSHOT_TTL_SEC` is only read at the one `sharedCacheSet` call
that writes `gex-matrix-snapshot:<ticker>`, and that key is only read back inside this same route.
No other file reads or writes `gex-matrix-snapshot:*` (grepped repo-wide). `calculateMatrixDelta`
and `broadcastMatrixDelta` are unchanged — this fix only widens how long the "previous" input to
that existing, correct logic survives in cache.

### Fix rationale

Rather than inventing a second, independently-tuned TTL, the new `GEX_MATRIX_SNAPSHOT_TTL_SEC`
constant is defined as `= OVERLAP_LOCK_TTL_SEC` (240s) — the ceiling the same file's own header
comment already establishes and justifies against this exact route's measured max runtime
(209.2s). This keeps the two TTLs in lockstep by construction (a future change to one moves the
other) rather than leaving two numbers that are supposed to agree drift apart again. Deliberately
left unchanged: `OVERLAP_LOCK_TTL_SEC` itself (already correctly calibrated per its own comment),
the cooldown constants, and `calculateMatrixDelta`/`broadcastMatrixDelta` (correct logic — only
their input's cache lifetime was wrong). No runtime behavior other than the one TTL value changed.
