import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

test("member /api/market/spx/play delegates to getSpxPlayState (single derivation)", () => {
  const route = readFileSync(join(ROOT, "src/app/api/market/spx/play/route.ts"), "utf8");
  assert.match(route, /getSpxPlayState/);
  assert.match(route, /peekSpxPlayState/);
  assert.doesNotMatch(route, /readSpxPlaySnapshot/);
  assert.doesNotMatch(route, /buildPlayTechnicals/);
});

test("getSpxPlayState owns the shared play-read cache (member + BIE + Largo)", () => {
  const service = readFileSync(join(ROOT, "src/features/spx/lib/spx-service.ts"), "utf8");
  assert.match(service, /withServerCache\(`spx-play-read:\$\{date\}`/);
  assert.match(service, /peekSpxPlayState/);
  assert.match(service, /playMemberReadCacheSec/);
  assert.match(service, /staleWhileRevalidate:\s*false/);
  assert.match(service, /maxBlockMs:\s*playMemberReadMaxBlockMs/);
  assert.match(service, /evaluateSpxPlayStateCrossReplica/);
  assert.match(service, /sharedCacheSetNx/);
  assert.match(service, /degradedPlayPayload/);
});

test("getSpxPlayState and getSpxDeskSummary round at derivation (BIE/Largo parity)", () => {
  const service = readFileSync(join(ROOT, "src/features/spx/lib/spx-service.ts"), "utf8");
  const evalBlock = service.match(/async function evaluateSpxPlayState\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(evalBlock, "evaluateSpxPlayState block present");
  assert.match(evalBlock![0], /return roundFloats\(\{/);
  assert.match(service, /return roundFloats\(summarizeSpxDesk\(merged\)\)/);
});

test("member /api/market/spx/play catch returns degradedPlayPayload shape", () => {
  const route = readFileSync(join(ROOT, "src/app/api/market/spx/play/route.ts"), "utf8");
  assert.match(route, /degradedPlayPayload/);
});

test("getSpxPlayState's withServerCache call never caches an unassessed/degraded placeholder (2026-10-08 fix)", () => {
  // evaluateSpxPlayStateCrossReplica() can RESOLVE (not throw) to degradedPlayPayload()
  // when this replica loses the cross-replica Redis lock and no stale/peer snapshot shows
  // up in time — a routine outcome given the 5s TTL here, not a rare one. Without a
  // shouldCache guard, server-cache.ts's refreshCache() persists ANY resolved value for the
  // full TTL (in-memory AND shared Redis), so one lock-contention loss gets amplified into
  // every reader of this cache key seeing "Desk warming" for the next TTL window — measured
  // live 2026-10-08: ~50% of a 12-call burst over 24s came back `degraded:true`, several
  // sharing an identical `as_of` (the same cached placeholder served repeatedly). `assessed`
  // is explicitly `false` ONLY on that placeholder path (see SpxPlayPayload's own doc
  // comment) and never on a genuine closed-session assessment, so it is the correct guard —
  // the same shape as Night Hawk edition route's `available !== false` shouldCache.
  const service = readFileSync(join(ROOT, "src/features/spx/lib/spx-service.ts"), "utf8");
  const fn = service.match(/export async function getSpxPlayState\(\)[\s\S]*?\n\}/);
  assert.ok(fn, "getSpxPlayState function present");
  assert.match(fn![0], /shouldCache:\s*\(\w+\)\s*=>.*assessed\s*!==\s*false/);
});

test("getSpxPlayState's withServerCache call passes the SAME freshness bound peekSpxPlayState enforces (2026-10-16 fix)", () => {
  // Without this, withServerCache's own `!swr` fast lane measures staleness against the
  // generic 10-minute MAX_STALE_AGE_MS for the `spx-play-read:<date>` key, while
  // peekSpxPlayState() one call earlier in the same request enforces a tight 20s bound
  // (playMemberPeekMaxAgeSec()) on the IDENTICAL key — the two call sites disagreeing let a
  // snapshot peekSpxPlayState() had just rejected as too stale get served anyway. Live-
  // reproduced: as_of jumping backward up to ~238s across consecutive /api/market/spx/play
  // polls. Regression guard: the fast-lane bound must match the peek bound, not the generic
  // default.
  const service = readFileSync(join(ROOT, "src/features/spx/lib/spx-service.ts"), "utf8");
  const fn = service.match(/export async function getSpxPlayState\(\)[\s\S]*?\n\}/);
  assert.ok(fn, "getSpxPlayState function present");
  assert.match(fn![0], /maxStaleAgeMs:\s*playMemberPeekMaxAgeSec\(\)\s*\*\s*1000/);
});

test("getSpxPlayState's withServerCache call is localOnly, so withServerCache's own generic Redis layer cannot clobber evaluateSpxPlayStateCrossReplica's deliberately-longer published TTL (2026-10-16 fix)", () => {
  // evaluateSpxPlayStateCrossReplica() publishes its own result to
  // `server:spx-play-read:<date>` via a direct sharedCacheSet with a DELIBERATE
  // Math.max(playMemberReadCacheSec() * 2, 10) TTL (10s — double the 5s refresh cadence, so a
  // slow refresh cycle still leaves a stale copy for every other replica's `!won` branch and
  // spxPlayReadFallback to find). Without `localOnly`, withServerCache's OWN generic Redis write
  // (server-cache.ts's writeRedisCache, fired moments later with the outer 5s ttlMs) is a SECOND,
  // uncoordinated writer to the exact same key — its generation guard only skips a write that is
  // OLDER than the last one, it has no concept of "don't shorten an already-longer TTL", so it
  // deterministically overwrote the 10s TTL down to 5s on every single successful eval. Confirmed
  // live via CloudWatch: repeated "cold miss exceeded maxBlockMs" throws on
  // GET /api/market/spx/play during RTH (2026-10-15 14:33/15:17/17:02/17:27/19:25 UTC),
  // correlating with sustained UW provider queue congestion in the same windows — exactly the
  // scenario the 10s margin exists to survive. `localOnly` removes the second writer, leaving
  // evaluateSpxPlayStateCrossReplica's own lock + explicit sharedCacheGetWithTtl reads (here and
  // in spxPlayReadFallback) as the sole owner of this key's cross-replica publish/read semantics.
  const service = readFileSync(join(ROOT, "src/features/spx/lib/spx-service.ts"), "utf8");
  const fn = service.match(/export async function getSpxPlayState\(\)[\s\S]*?\n\}/);
  assert.ok(fn, "getSpxPlayState function present");
  assert.match(fn![0], /localOnly:\s*true/);
});

test("GET /api/market/spx/play's catch block distinguishes a cache-timing race from a generic crash (2026-10-16 fix)", () => {
  // A ServerCacheTimeoutError (server-cache.ts) means the cache/fallback chain couldn't finish
  // in time — NOT that the underlying desk has no data (confirmed live: a parallel
  // GET /api/market/spx/desk call at the identical millisecond returned live price/VIX while
  // this route was throwing). The catch block must not assert "Desk warming" (degradedPlayPayload's
  // default headline) for this specific, known cause.
  const route = readFileSync(join(ROOT, "src/app/api/market/spx/play/route.ts"), "utf8");
  assert.match(route, /ServerCacheTimeoutError/);
  assert.match(route, /instanceof ServerCacheTimeoutError/);
});

test("GET /api/market/spx/play's catch block derives a real session_phase from a desk peek instead of hardcoding 'closed' (2026-10-21 fix)", () => {
  // BUG (live repro 2026-10-21 ~11:34 ET): the 2026-10-16 fix above corrected the catch block's
  // HEADLINE text for a ServerCacheTimeoutError but left degradedPlayPayload()'s hardcoded
  // session_phase: "closed" default untouched — the same false "desk is closed" claim, on a
  // different field. spx-play-verdict-bar.ts's resolveMode() reads session_phase === "closed"
  // directly to pick the member-facing verdict badge, so a member hitting this exact timeout
  // mid-RTH saw a CLOSED badge while GET /api/market/spx/desk reported market_open:true at the
  // identical instant. The catch block must now peek the desk (proven cheap/non-blocking even
  // when the play-eval pipeline itself times out) and pass a real session_phase through extras.
  const route = readFileSync(join(ROOT, "src/app/api/market/spx/play/route.ts"), "utf8");
  assert.match(route, /peekMergedSpxDesk/);
  assert.match(route, /currentSessionPhase\(deskPeek\.merged\)/);
});

test("evaluateSpxPlayState skips buildPlayTechnicals/refreshOrBreakMemory/resolveGuardedPlaybookMatch when the market is closed and no play is open (2026-10-17 fix, updated 2026-10-18)", () => {
  // MEASURED LIVE: buildPlayTechnicals makes real Polygon network calls on a cold per-process
  // cache, which alone can exceed playMemberReadMaxBlockMs()'s 800ms budget — 5/5 live
  // reproductions on a closed-market Saturday threw ServerCacheTimeoutError on every single
  // call, 100% of that prework wasted, because evaluateSpxPlayCore's own fast "Session closed"
  // branch (spx-play-engine.ts) was never reached: this function used to build technicals/
  // or-break-memory/playbook-match UNCONDITIONALLY before calling into it. The fix mirrors
  // evaluateSpxPlayCore's own `!desk.market_open && !premarket` + loadOpenPlay() gate and
  // returns early via the shared closedMarketPlaySnapshot() helper — skipping all three
  // expensive calls — whenever that same condition holds.
  //
  // 2026-10-18 update: the early-return body was extracted into closedMarketPlaySnapshot()
  // (shared by both the fresh-desk gate here AND the off-hours peeked-desk gate added the same
  // day — see the next test) — so this test now checks evaluateSpxPlayState()'s body calls that
  // helper before buildPlayTechnicals, and separately checks the helper's own body for the
  // loadOpenPlay()/readSpxPlaySnapshot ordering that used to be inlined here.
  const service = readFileSync(join(ROOT, "src/features/spx/lib/spx-service.ts"), "utf8");

  const helperFn = service.match(/async function closedMarketPlaySnapshot\([\s\S]*?\n\}/);
  assert.ok(helperFn, "closedMarketPlaySnapshot helper must be present");
  const openPlayIdx = helperFn![0].search(/loadOpenPlay\(\)/);
  const earlyReturnIdx = helperFn![0].search(/readSpxPlaySnapshot\(merged,\s*null,\s*\{\}\)/);
  assert.ok(openPlayIdx >= 0, "helper must check loadOpenPlay() before deciding to skip the full eval");
  assert.ok(earlyReturnIdx >= 0, "helper must build the closed-market snapshot via readSpxPlaySnapshot(merged, null, {})");
  assert.ok(openPlayIdx < earlyReturnIdx, "loadOpenPlay() must be checked before building the closed-market snapshot");

  const fn = service.match(/async function evaluateSpxPlayState\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "evaluateSpxPlayState block present");
  const body = fn![0];

  const guardIdx = body.search(/if \(!merged\.market_open && !isPremarketPlanningWindow\(\)\)/);
  const helperCallIdx = body.search(/closedMarketPlaySnapshot\(merged\)/);
  const technicalsIdx = body.search(/buildPlayTechnicals\(merged\.price/);

  assert.ok(guardIdx >= 0, "market-closed guard must be present");
  assert.ok(helperCallIdx >= 0, "must call closedMarketPlaySnapshot(merged) on the fresh-desk path");
  assert.ok(technicalsIdx >= 0, "buildPlayTechnicals(merged.price, ...) full-eval path must still exist");

  // Ordering is the entire fix: the guard (and its helper call) must appear BEFORE the
  // unconditional buildPlayTechnicals call, not after — a regression that moves/removes the
  // guard while leaving buildPlayTechnicals untouched would pass a "both strings present"
  // check but silently reintroduce the live bug.
  assert.ok(guardIdx < technicalsIdx, "market-closed guard must run BEFORE buildPlayTechnicals");
  assert.ok(helperCallIdx < technicalsIdx, "closedMarketPlaySnapshot(merged) call must appear BEFORE buildPlayTechnicals");
});

test("evaluateSpxPlayState peeks the merged desk off-hours instead of paying loadMergedSpxDesk()'s cold-cache cost (2026-10-18 fix)", () => {
  // MEASURED LIVE 2026-10-18: even with the 2026-10-17 fix above, the closed-market fast path
  // still depended on `merged` from an UNCONDITIONAL `await loadMergedSpxDesk()` — and on a cold
  // spx-merged:<date> cache (reliably cold off-hours/weekends), that load alone can legitimately
  // take up to deskBootstrapMaxBlockMs() (3s default), which already exceeds the OUTER
  // playMemberReadMaxBlockMs() budget (800ms) wrapping the whole SPX-play read — so the honest
  // closed-market branch was STILL never reached. Reproduced live: 15-19/19 cold evals over two
  // separate 15-min windows, 0 successes. Fix: outside isSpxEngineCronWindow() (i.e. not real
  // trading hours), try a cheap, non-blocking peekMergedSpxDesk() first; only fall through to the
  // full loadMergedSpxDesk() call when the peek can't answer (null, market open, or premarket).
  const service = readFileSync(join(ROOT, "src/features/spx/lib/spx-service.ts"), "utf8");
  const fn = service.match(/async function evaluateSpxPlayState\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "evaluateSpxPlayState block present");
  const body = fn![0];

  const cronWindowGuardIdx = body.search(/if \(!isSpxEngineCronWindow\(\)\)/);
  const peekCallIdx = body.search(/peekMergedSpxDesk\(/);
  const peekHelperCallIdx = body.search(/closedMarketPlaySnapshot\(peeked\.merged\)/);
  const freshLoadIdx = body.search(/const \{ merged \} = await loadMergedSpxDesk\(\);/);

  assert.ok(cronWindowGuardIdx >= 0, "must gate the peek shortcut on !isSpxEngineCronWindow() — never active during real trading hours");
  assert.ok(peekCallIdx >= 0, "must call peekMergedSpxDesk() (non-blocking) instead of loadMergedSpxDesk() on the off-hours fast path");
  assert.ok(peekHelperCallIdx >= 0, "must build the closed-market snapshot from the PEEKED bundle (peeked.merged), not a fresh load, when the peek succeeds");
  assert.ok(freshLoadIdx >= 0, "the unconditional fresh loadMergedSpxDesk() call must still exist as the fallback for every other case");

  // Ordering: the cron-window-gated peek attempt must happen BEFORE the unconditional fresh
  // load — that is the entire fix. A regression that reorders these would silently reintroduce
  // the bug (every off-hours eval would again pay loadMergedSpxDesk()'s full cold-cache cost).
  assert.ok(cronWindowGuardIdx < freshLoadIdx, "cron-window guard must run BEFORE the fresh loadMergedSpxDesk() call");
  assert.ok(peekCallIdx < freshLoadIdx, "peekMergedSpxDesk() call must run BEFORE the fresh loadMergedSpxDesk() call");
});

test("peekSpxPlayState checks isSpxPlaySnapshotFreshEnough on BOTH the in-process and Redis-backed peek paths (2026-09-13 fix)", () => {
  const service = readFileSync(join(ROOT, "src/features/spx/lib/spx-service.ts"), "utf8");
  const fn = service.match(/export async function peekSpxPlayState\(\)[\s\S]*?\n\}/);
  assert.ok(fn, "peekSpxPlayState function present");
  const body = fn![0];
  assert.match(body, /playMemberPeekMaxAgeSec/);
  // one call guarding `mem`, one guarding `hit.value` — a regression that drops the check from
  // either path re-opens the live bug (up to ~234s-stale snapshots served as fresh).
  const guardCalls = body.match(/isSpxPlaySnapshotFreshEnough\(/g) ?? [];
  assert.equal(guardCalls.length, 2, "expected exactly two freshness-guarded peek paths (mem + hit.value)");
  assert.match(body, /if \(mem && isSpxPlaySnapshotFreshEnough\(mem\.as_of/);
  assert.match(body, /if \(hit\?\.value && isSpxPlaySnapshotFreshEnough\(hit\.value\.as_of/);
});

test("spxPlayReadDegraded derives a real session_phase from a desk peek instead of hardcoding 'closed' (2026-10-21 fix)", () => {
  // Sibling fix to the route.ts catch-block fix above, same root cause: this function is ALSO
  // reached on genuine lock-contention/stale-cache-miss paths (evaluateSpxPlayStateCrossReplica
  // losing the cross-replica lock with no stale/peer snapshot, spxPlayReadFallback finding
  // neither) — not only on the ServerCacheTimeoutError the route.ts fix targets. Every one of
  // those paths can fire during a genuinely open RTH session, so the same false
  // session_phase: "closed" default was reachable here too, independent of the route-level fix.
  const service = readFileSync(join(ROOT, "src/features/spx/lib/spx-service.ts"), "utf8");
  const fn = service.match(/async function spxPlayReadDegraded\(\)[\s\S]*?\n\}/);
  assert.ok(fn, "spxPlayReadDegraded function present");
  const body = fn![0];
  assert.match(body, /peekMergedSpxDesk\(\)/);
  assert.match(body, /currentSessionPhase\(peeked\.merged\)/);
});
