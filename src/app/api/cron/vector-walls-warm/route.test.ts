// Regression: vector-walls-warm must handshake via after() so Cloudflare never 504s
// the cron before logCronRun fires (ops #2118 — same class as vector-bead-record #1783).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);
const leaderLogicSrc = readFileSync("src/lib/rth-warm-leader-logic.ts", "utf8");

test("vector-walls-warm dispatches warming in after() and returns 202", () => {
  assert.match(routeSrc, /warmVectorWalls/);
  assert.match(routeSrc, /after\(dispatchWarming\)/, "must use after() for fire-and-forget handshake");
  assert.match(routeSrc, /status:\s*202/, "must return HTTP 202 accepted");
  assert.match(routeSrc, /await logCronRun\("vector-walls-warm"/, "must log cron handshake before response");
  assert.doesNotMatch(
    routeSrc,
    /await logCronRun\("vector-walls-warm"[\s\S]*await getTickersToWarmAsync/,
    "logCronRun must not await the heavy warm inline"
  );
});

test("rth-warm-leader watches vector-walls-warm with sub-minute heal threshold", () => {
  assert.match(leaderLogicSrc, /"vector-walls-warm":\s*20\s*\/\s*60/);
});

test("vector-walls-warm acquires a cross-replica overlap lock before dispatching", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before dispatch, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of dispatching a second warm", () => {
  assert.match(
    routeSrc,
    /skipped: true,\s*\n\s*reason: "previous Vector walls warm still in flight/
  );
  const skipIdx = routeSrc.indexOf('reason: "previous Vector walls warm still in flight');
  const dispatchIdx = routeSrc.indexOf("after(dispatchWarming)");
  assert.ok(skipIdx > 0 && dispatchIdx > 0 && skipIdx < dispatchIdx);
});

test("the overlap lock fails OPEN on a Redis error rather than wedging the cron shut", () => {
  assert.match(
    routeSrc,
    /sharedCacheSetNx\([\s\S]{0,120}\)\.catch\(\(\) => true\)/,
    "a Redis error must not permanently block every future warm"
  );
});

test("the lock is released in a finally block so a thrown warm still frees the next run", () => {
  const finallyBlock = /\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}/;
  assert.match(routeSrc, finallyBlock, "release must run on both the success and error paths");
});

test("the lock TTL covers maxDuration as the safety-net ceiling (240s = 2× 120s maxDuration)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 240/);
});
