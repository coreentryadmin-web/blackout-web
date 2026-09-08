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
