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

test("evaluateSpxPlayState skips buildPlayTechnicals/refreshOrBreakMemory/resolveGuardedPlaybookMatch when the market is closed and no play is open (2026-10-17 fix)", () => {
  // MEASURED LIVE: buildPlayTechnicals makes real Polygon network calls on a cold per-process
  // cache, which alone can exceed playMemberReadMaxBlockMs()'s 800ms budget — 5/5 live
  // reproductions on a closed-market Saturday threw ServerCacheTimeoutError on every single
  // call, 100% of that prework wasted, because evaluateSpxPlayCore's own fast "Session closed"
  // branch (spx-play-engine.ts) was never reached: this function used to build technicals/
  // or-break-memory/playbook-match UNCONDITIONALLY before calling into it. The fix mirrors
  // evaluateSpxPlayCore's own `!desk.market_open && !premarket` + loadOpenPlay() gate and
  // returns early via readSpxPlaySnapshot(merged, null, {}) — skipping all three expensive
  // calls — whenever that same condition holds.
  const service = readFileSync(join(ROOT, "src/features/spx/lib/spx-service.ts"), "utf8");
  const fn = service.match(/async function evaluateSpxPlayState\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "evaluateSpxPlayState block present");
  const body = fn![0];

  const guardIdx = body.search(/if \(!merged\.market_open && !isPremarketPlanningWindow\(\)\)/);
  const openPlayIdx = body.search(/loadOpenPlay\(\)/);
  const earlyReturnIdx = body.search(/readSpxPlaySnapshot\(merged,\s*null,\s*\{\}\)/);
  const technicalsIdx = body.search(/buildPlayTechnicals\(merged\.price/);

  assert.ok(guardIdx >= 0, "market-closed guard must be present");
  assert.ok(openPlayIdx >= 0, "must check loadOpenPlay() before deciding to skip the full eval");
  assert.ok(earlyReturnIdx >= 0, "must early-return via readSpxPlaySnapshot(merged, null, {})");
  assert.ok(technicalsIdx >= 0, "buildPlayTechnicals(merged.price, ...) full-eval path must still exist");

  // Ordering is the entire fix: the guard (and its early return) must appear BEFORE the
  // unconditional buildPlayTechnicals call, not after — a regression that moves/removes the
  // guard while leaving buildPlayTechnicals untouched would pass a "both strings present"
  // check but silently reintroduce the live bug.
  assert.ok(guardIdx < technicalsIdx, "market-closed guard must run BEFORE buildPlayTechnicals");
  assert.ok(openPlayIdx < technicalsIdx, "loadOpenPlay() check must run BEFORE buildPlayTechnicals");
  assert.ok(earlyReturnIdx < technicalsIdx, "early return must appear BEFORE buildPlayTechnicals");
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
