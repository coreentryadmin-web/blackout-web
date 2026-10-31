> **kind:** FINDING

## SPX Slayer `GET /api/market/spx/play` off-hours fast path can trust a degraded bootstrap-shell snapshot for extended periods, serving a frozen `assessed:false` read while the real desk is healthy — FIXED

**Status:** Fixed, regression test added (`src/features/spx/lib/spx-service-degraded-shell-peek.test.ts`).

### Root cause

`evaluateSpxPlayState()`'s off-hours fast path (`src/features/spx/lib/spx-service.ts`) peeks the
shared `spx-merged:<date>` cache with a deliberately generous 24h staleness tolerance
(`peekMergedSpxDesk({ maxStaleMs: 24 * 60 * 60 * 1000 })`) — correct in spirit, since once the
market is genuinely closed, "stale" and "correct" are the same thing. But it trusted **any**
non-null peek result that reported `market_open:false`, with no check on *what kind* of snapshot
it actually got.

That peeked bundle can be a **degraded bootstrap shell** rather than a real merged-desk build:

1. `loadMergedSpxDeskCore()` (`spx-desk-loader.ts`) builds `spx-merged:<date>`'s value from
   `Promise.all([loadSpxDesk(), loadSpxDeskFlow(), loadSpxDeskPulse()])`. `loadSpxDesk()` itself is
   a `withServerCache`-wrapped call whose `fallback` is `deskShellFromPulse(await
   loadSpxDeskPulse())` — triggered whenever the real `buildSpxDesk()` blows
   `deskBootstrapMaxBlockMs()` (3s default, more likely to race off-hours when nothing keeps the
   lane hot).
2. `deskShellFromPulse` → `mergePulseIntoDesk(emptyDeskPayload(...), pulse)`. `emptyDeskPayload`
   sets `source: "none"` and `mergePulseIntoDesk` never reassigns `source` (only `available` was
   fixed to inherit `pulse.available` in an earlier PR) — so the shell keeps `source: "none"`
   forever while still carrying a real price and `available: true`.
3. That fallback **resolves, it does not throw** — so `loadMergedSpxDeskCore()` "succeeds" with the
   degraded `desk` folded into `merged`, and `withServerCache`'s `refreshCache()` writes this
   `source: "none"` bundle into `spx-merged:<date>` (local store + Redis) exactly as if it were a
   normal fresh build.
4. `peekMergedSpxDesk()` is a pure `peekServerCache` read — it **never invokes a loader or
   triggers any SWR background refresh**. Once a replica's local in-process copy is poisoned this
   way, nothing on the peek path ever replaces it. The only thing that calls the real
   `loadMergedSpxDesk()` off-hours is `maybeRefreshMergedSpxDeskOffHours()`, throttled by a
   **fleet-wide** `sharedCacheSetNx` lock (one replica, once per
   `spxMergedDeskOffHoursRefreshIntervalSec()`, 5 min default) — and even when that throttle fires
   on the *same* poisoned replica within the entry's own 10s TTL, it just re-reads the identical
   still-cached value, doing nothing.
5. `spx-play-engine.ts`'s own closed-market branch already treats this exact shape as
   untrustworthy: `const closedConfluence = desk.price > 0 && desk.source !== "none" ?
   computeSpxConfluence(desk) : null;` — a cold-cache bootstrap shell "has a real price and
   available:true but no GEX/flow layer ever merged in". But `evaluateSpxPlayState()`'s off-hours
   gate never applied that same check *before* deciding to trust the peek, so it handed exactly the
   shape `spx-play-engine.ts` itself distrusts straight into `closedMarketPlaySnapshot()`, which
   (correctly, given its input) produced a fully degenerate `assessed:false/score:0/factors:[]/
   direction:null` response with a frozen `as_of` — honest given the input, but the input itself
   should never have been trusted when a healthy build was available one bounded call away.

### Evidence

Live repro (2026-10-31, genuinely closed Saturday market, `mintClerkPremiumSession`-authenticated
admin/premium session against `https://blackouttrades.com`):

- **Run A** (16:09:28.622Z): `GET /api/market/spx/play` → `{"assessed":false,"score":0,
  "factors":[],"direction":null,"as_of":"2026-10-31T16:06:52.996Z","session_phase":"closed",
  "thesis":"Desk offline · CLOSED · resumes 6:30 AM PT"}` while the **same-instant**
  `GET /api/market/spx/desk` → `{"available":true,"source":"polygon+uw-flow","price":7580.07,
  "as_of":"2026-10-31T16:06:52.914Z"}` and `GET /api/market/spx/bootstrap`'s `merged` lane
  independently confirmed `{"available":true,"source":"polygon+uw-flow","price":7580.07,
  "market_open":false}`.
- **Run B** (16:15:03.661Z, 5m35s later, a fresh script/session): `GET /api/market/spx/play`
  returned the **byte-identical** degenerate result — same frozen `as_of
  2026-10-31T16:06:52.996Z` — while `/api/market/spx/desk` at that instant showed a healthy,
  current desk (`as_of 2026-10-31T16:12:35.468Z`).
- In both runs the very next poll (15–23s later) flipped `/api/market/spx/desk`'s own `source` to
  `"none"` momentarily (the bootstrap-shell signature), and `/api/market/spx/play` on that or the
  next poll flipped to a genuine `assessed:true/score:28/factors:11/direction:long` read —
  consistent with ALB round-robin bouncing between a healthy replica and one whose own
  `spx-merged:<date>` local copy was frozen on a `source:"none"` snapshot from ~16:06:52.
- This is **not** the PR #7031 bug (`isSpxPlaySnapshotShareable` trusting a degenerate value
  indefinitely from the cross-replica *shared* single-flight cache) — the byte-identical `as_of`
  recurring fresh 5m35s apart, computed independently by `evaluateSpxPlayState()` rather than
  served from that ~10–20s-bounded shared cache, points at this underlying per-replica desk-peek
  layer specifically.

**Regression test** (`spx-service-degraded-shell-peek.test.ts`, new file): mocks `peekMergedSpxDesk`
to return a `source:"none"` shell and `loadMergedSpxDesk` to return a healthy
`source:"polygon+uw-flow"` bundle, then calls the real exported
`evaluateSpxPlayStateCrossReplica()`.

- **RED (pre-fix, verified via `git stash`):** `loadMergedSpxDesk` never called
  (`loadMergedCalls === 0`); the served snapshot's `direction` field (smuggling `merged.source`
  through the mocked `readSpxPlaySnapshot`) read `"none"` — the poisoned shell was served as-is.
- **GREEN (post-fix):** `loadMergedSpxDesk` called exactly once; the served snapshot's `direction`
  reads `"polygon+uw-flow"` — the healthy fresh load wins instead.
- Updated the sibling fixture in `spx-service-merged-desk-bg-refresh.test.ts` (that suite's own
  `closedBundle()` had been using `source:"none"` for its *unrelated* throttle-wiring scenario,
  which the new gate would otherwise reject for the wrong reason) to use a real-build source
  marker — re-ran, both its tests still pass.
- Full `src/features/spx/lib` suite: 910/910 pass. `npx tsc --noEmit`: clean. `eslint` on touched
  files: clean.

### Blast radius

Single call site: `evaluateSpxPlayState()`'s off-hours gate in `spx-service.ts`. This function is
the shared derivation for member `GET /api/market/spx/play`, BIE's `spx_full_state`, and Largo's
`get_spx_play` tool (per the function's own doc comment) — all three now get the same corrected
behavior. `evaluateSpxPlayState()`'s own second gate (against a *fresh* `loadMergedSpxDesk()`
result, a few lines below) was already correct in spirit but untouched by this change — it is the
fallback path this fix now routes into more often, and its behavior is unchanged.

### Fix rationale

Added `peeked.merged.source !== "none"` to the existing trust condition, mirroring the identical
check `spx-play-engine.ts` already applies for the exact same reason. When the peek is a degraded
shell, the branch is skipped entirely (same as a null peek, an open market, or premarket) and
execution falls through to the existing, already `maxBlockMs`-bounded `loadMergedSpxDesk()` call —
no new code path, no new timeout budget, just extending the existing "peek unusable → do a real
bounded load" fallback to cover one more case it was missing. `maybeRefreshMergedSpxDeskOffHours()`
is also skipped in this case (it would have been a redundant, indirect way to get the same bounded
load this fix now performs directly and synchronously).

### Deliberately left unchanged

- `maybeRefreshMergedSpxDeskOffHours()`'s own fleet-wide throttle design — still correct for the
  (far more common) case where the peek *is* a genuine build; this fix only changes behavior when
  the peek is specifically a `source:"none"` shell.
- `mergePulseIntoDesk`'s handling of every other field — only `source`'s lack of reassignment was
  relevant here, and it is a documented, deliberate shell marker (not itself touched by this fix).
- `spx-play-engine.ts`'s `desk.source !== "none"` gate — already correct; this fix makes the
  upstream caller apply the same standard before even reaching that code, rather than duplicating
  or weakening it.
