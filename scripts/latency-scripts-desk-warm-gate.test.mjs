import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Source-scan regression pin: `latency-burst-audit.mjs` and `compare-latency-envs.mjs` both
// unconditionally hit `/api/cron/desk-warm?force=1` (plus heatmap-warm/zerodte-warm) with no
// hours gate — confirmed live contributors to the #4013 weekend desk-warm force=1 storm
// (validate-deploy.mjs was fixed in #4017 via `isDeployCacheWarmAllowed`, but the storm
// continued post-deploy at ~73% of the original rate — these two scripts are why).
//
// `isDeployCacheWarmAllowed` itself is already fully unit-tested (cache-warm-deploy-gate.test.mjs);
// this only pins that both scripts actually call it before dispatching the force=1 warm paths, so
// a future edit can't silently drop the gate and reopen the storm.

const __dirname = dirname(fileURLToPath(import.meta.url));

function read(rel) {
  return readFileSync(join(__dirname, rel), "utf8");
}

test("latency-burst-audit.mjs imports and calls isDeployCacheWarmAllowed before its force=1 warm loop", () => {
  const src = read("latency-burst-audit.mjs");
  assert.match(src, /import\s*\{\s*isDeployCacheWarmAllowed\s*\}\s*from\s*"\.\/lib\/cache-warm-deploy-gate\.mjs"/);
  const warmFnIdx = src.indexOf("async function warm(");
  const gateCallIdx = src.indexOf("isDeployCacheWarmAllowed()", warmFnIdx);
  const forceWarmIdx = src.indexOf('"/api/cron/desk-warm?force=1"', warmFnIdx);
  assert.ok(warmFnIdx >= 0 && gateCallIdx > warmFnIdx, "gate check must be inside warm()");
  assert.ok(forceWarmIdx > gateCallIdx, "the force=1 dispatch must come after the gate check");
});

test("compare-latency-envs.mjs imports and calls isDeployCacheWarmAllowed before its force=1 warm loop", () => {
  const src = read("compare-latency-envs.mjs");
  assert.match(src, /import\s*\{\s*isDeployCacheWarmAllowed\s*\}\s*from\s*"\.\/lib\/cache-warm-deploy-gate\.mjs"/);
  const warmFnIdx = src.indexOf("async function warmCaches(");
  const gateCallIdx = src.indexOf("isDeployCacheWarmAllowed()", warmFnIdx);
  const forceWarmIdx = src.indexOf('"/api/cron/desk-warm?force=1"', warmFnIdx);
  assert.ok(warmFnIdx >= 0 && gateCallIdx > warmFnIdx, "gate check must be inside warmCaches()");
  assert.ok(forceWarmIdx > gateCallIdx, "the force=1 dispatch must come after the gate check");
});
