# SPX Slayer — `evaluateSpxPlayStateCrossReplica()` publishes a degenerate (`assessed:false`) eval result to the shared cross-replica cache with no gate, no ordering guard — 5th instance of this cache key's staleness/non-monotonic bug class — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P1 (member-facing, live, reproduced against production): `GET /api/market/spx/play` served non-monotonic, flapping results off-hours — alternating between a genuine scored read (`assessed:true`, score 36, `direction:"long"`) and a dead placeholder (`assessed:true`-shaped but `assessed:false`, score 0, `direction:null`) across consecutive polls ~13s apart, with `as_of` jumping BACKWARD to an exact byte-identical older generation (`2026-10-31T17:26:16.480Z`) 22+ minutes after it was first observed, then forward again — while the sibling `GET /api/market/spx/desk` stayed healthy (`source:"polygon+uw-flow"`) and monotonic throughout the identical polling window. |
| **Area** | SPX Slayer play system — `src/features/spx/lib/spx-service.ts` (`evaluateSpxPlayStateCrossReplica`) |
| **Status** | FIXED |

### Root cause

`evaluateSpxPlayStateCrossReplica()`'s winning-the-lock branch publishes its eval result to the
shared cross-replica Redis key (`spx-play-read:<date>`, via `spxPlayServerCacheKey`) with a bare,
**unconditional** `sharedCacheSet(...)` call:

```ts
const result = await evaluateSpxPlayState();
void sharedCacheSet(spxPlayServerCacheKey(date), result, Math.max(playMemberReadCacheSec() * 2, 10))
  .catch(() => undefined);
return result;
```

Every other reader/writer of this exact payload shape treats `assessed: false` as a one-off,
must-never-persist placeholder:

- `getSpxPlayState()`'s own `withServerCache` call (a few lines below, in the same file) passes
  `shouldCache: (value) => value.assessed !== false` specifically so a degenerate eval never
  poisons the local in-memory cache.
- `isSpxPlaySnapshotShareable()` (`spx-play-freshness.ts`, fixed 2026-10-31 earlier the same day in
  a sibling PR) requires `assessed !== false` before granting its "regardless of age" cross-replica
  trust exemption, precisely so a degenerate closed-market placeholder is never treated as a
  genuine, indefinitely-shareable read.

This one explicit write is the **sole publisher** to this Redis key (`getSpxPlayState()` passes
`localOnly: true`, so `withServerCache`'s own `shouldCache`-guarded Redis write — `writeRedisCache`
in `server-cache.ts` — never runs for this key at all), and it carries neither protection: no
`shouldCache`-equivalent gate on content, and no `server-gen:<key>` generation stamp (that stamp,
and `peekServerCache`'s own matching read-side check added in a sibling fix the same day, both live
inside `writeRedisCache`/`readRedisGeneratedAt`, which this raw `sharedCacheSet` call never goes
through).

Consequence: whenever `evaluateSpxPlayState()` legitimately resolves `assessed: false` (a normal,
routine outcome off-hours whenever `loadMergedSpxDesk()`'s own bounded load falls back to a
degraded `source:"none"` shell under load, or any other transient "nothing was assessed" path —
see `SpxPlayPayload.assessed`'s own doc comment), that placeholder got published as if it were the
genuine "current play state" for every other replica's `waitForPeerSpxPlaySnapshot`/
`spxPlayReadFallback`/`peekSpxPlayState` to trust and replay — with no ordering guard against an
OLDER-vintage write later clobbering a newer good one, and with `peekServerCache`'s local-copy
fallback (no generation metadata on this key ⇒ "age unknown, trust it") free to keep re-serving
that exact copy for its own un-overridden 10-minute ceiling, well past this route's real ~20s
freshness contract (`playMemberPeekMaxAgeSec()`).

### Evidence

Live, authenticated (temp Clerk admin+premium user, deleted after), production, 2026-10-31
(Saturday, market genuinely closed) — polled `GET /api/market/spx/play` and `GET
/api/market/spx/desk` together, ~13-16s apart:

```
i=0  wall=17:46:28  play: assessed=false score=0  direction=null as_of=17:45:49.615Z | desk: healthy as_of=17:34:36.056Z
i=1  wall=17:46:46  play: assessed=false score=0  direction=null as_of=17:45:52.345Z | desk: healthy as_of=17:45:49.362Z
i=2  wall=17:47:01  play: assessed=false score=0  direction=null as_of=17:47:04.555Z degraded=true | desk: healthy as_of=17:45:49.362Z
i=3  wall=17:47:17  play: assessed=true  score=36 direction=long as_of=17:42:59.543Z | desk: healthy as_of=17:46:30.271Z
i=4..7  (same assessed:true/score:36/as_of=17:42:59.543Z, stable — a legitimate closed-market desk-anchored read)
i=8  wall=17:48:32  play: assessed=false score=0  direction=null as_of=17:26:16.480Z  <-- 22 MINUTES OLDER than i=3's as_of, byte-identical to a value this exact mechanism would have produced over 20 minutes earlier
i=9  wall=17:48:48  play: assessed=false score=0  direction=null as_of=17:48:32.729Z
```

`GET /api/market/spx/desk` never once reported anything but a healthy, fresh, monotonically
advancing `polygon+uw-flow` read across the entire window — ruling out an upstream data problem;
the defect is specific to this one cache key's publish/read mechanics.

Two already-merged sibling fixes from earlier the same day (`isSpxPlaySnapshotShareable()`'s
`assessed` gate, and `peekServerCache`'s Redis-hit generation-staleness check) were **already
present in the source checked out for this fix** and did **not** stop the reproduction above —
consistent with the root cause: both sibling fixes protect paths that read/trust an
ALREADY-PUBLISHED value; neither one prevents THIS call site from publishing a degenerate value in
the first place, and the generation-staleness check is specifically moot for this key because this
call site's raw `sharedCacheSet` never writes the `server-gen:<key>` metadata that check depends
on.

### Fix

Gate the publish exactly like every sibling path already does:

```ts
if ((result as { assessed?: boolean }).assessed !== false) {
  void sharedCacheSet(spxPlayServerCacheKey(date), result, Math.max(playMemberReadCacheSec() * 2, 10))
    .catch(() => undefined);
}
return result;
```

A degenerate result is still returned to the ONE caller that triggered this eval (unchanged
behavior for that single request) — it is simply never again handed to OTHER replicas as the
shared "current" snapshot.

### Blast radius

Scoped to this one explicit write in `evaluateSpxPlayStateCrossReplica()` — the only call site that
writes to the `spx-play-read:<date>` Redis key at all (confirmed: `getSpxPlayState()`'s own
`withServerCache` call passes `localOnly: true`, so its generic Redis write is already skipped for
this key). No other reader/writer of this key is touched. `evaluateSpxPlayState()` itself, the
closed-market engine (`spx-play-engine.ts`), and every other cache key in `server-cache.ts` are
unchanged.

### Fix rationale

Considered also adding a generation-ordering guard (mirroring `writeRedisCache`'s
`server-gen:<key>` check) to this same call site, to close the "older-vintage write clobbers a
newer good one" half of the mechanism too. Scoped this PR to the simpler, directly-evidenced gate
(`assessed !== false`) that a sibling fix earlier the same day already established as this exact
payload's shared convention — the live-reproduced symptom (a degenerate snapshot getting published
and later replayed) is fully explained and closed by never publishing the degenerate value at all,
without needing the ordering guard. If a future session finds a 6th instance of this pattern where
two genuinely non-degenerate writes race out of order, that is the natural next, narrower follow-up
— not folded into this fix to keep it single-issue.

### Regression test

`src/features/spx/lib/spx-service-cross-replica-degenerate-publish.test.ts` (new). Mocks
`shared-cache`/`spx-desk-loader`/`spx-play-session-guards`/`spx-evaluator`/`spx-play-store`/
`spx-voice-feed-store` (same pattern as the sibling `spx-service-degraded-shell-peek.test.ts`) so
`evaluateSpxPlayState()` deterministically resolves `assessed:false`, then asserts
`evaluateSpxPlayStateCrossReplica()` never calls `sharedCacheSet` with a key containing
`spx-play-read` for that result.

RED→GREEN proven: reverted the `assessed !== false` guard (restoring the bare unconditional
`sharedCacheSet` call), confirmed the new test fails (`1 !== 0`, i.e. the degenerate result WAS
published), restored the fix, confirmed the test passes.

Full scoped run post-fix: `spx-service-cross-replica-degenerate-publish.test.ts` (1/1),
`spx-service-cross-replica-lock.test.ts` (1/1), `spx-service-degraded-shell-peek.test.ts` (1/1),
`spx-service-merged-desk-bg-refresh.test.ts` (2/2), `spx-service-play-cache-staleness.test.ts`
(3/3), `spx-service.play.test.ts` (15/15), `server-cache*.test.ts` (22/22) — all pass.
`npx tsc --noEmit` clean. `npx eslint` clean on both touched files.
