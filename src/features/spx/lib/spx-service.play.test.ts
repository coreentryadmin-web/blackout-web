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
