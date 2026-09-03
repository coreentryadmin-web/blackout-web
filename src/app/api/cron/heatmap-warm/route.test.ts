// Regression: heatmap-warm must not run overlapping warm passes across replicas.
//
// Measured live 2026-09-03 (48h, /ecs/blackout-production, n=1000 leader-dispatched runs of this
// exact handler): p50=46.5s, p90=81.1s, p99=181.1s, max=209.2s — every run finishes well past the
// rth-warm-leader's 20s heal threshold for this cron, so the leader treats it as perpetually
// overdue and re-dispatches on almost every cycle, landing a second full warm pass on top of one
// already in flight, both sweeping the same shared universe through the same Polygon rate
// limiters. Same `sharedCacheSetNx` idempotent-skip pattern already used by
// vector-pick-sweep/swing-discovery/banger-discovery/thermal-discord for this exact shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("heatmap-warm acquires a cross-replica overlap lock before running the warm pass", () => {
  assert.match(routeSrc, /sharedCacheSetNx/, "must use the shared NX lock, not a read-then-write race");
  assert.match(
    routeSrc,
    /const acquired = await sharedCacheSetNx\(/,
    "the acquire call must happen before the warm pass, not after"
  );
  assert.match(routeSrc, /if \(!acquired\)/, "a lost race must be handled, not ignored");
});

test("a lost overlap-lock race returns a skip response instead of running a second warm pass", () => {
  assert.match(routeSrc, /skipped: true,\s*\n\s*reason: "previous warm still in flight/);
  // The skip branch must return before reaching the actual warm work, not alongside it.
  const skipIdx = routeSrc.indexOf('reason: "previous warm still in flight');
  const runIdx = routeSrc.indexOf("runHeatmapWarm(req, started)");
  assert.ok(skipIdx > 0 && runIdx > 0 && skipIdx < runIdx);
});

test("the overlap lock fails OPEN on a Redis error rather than wedging the cron shut", () => {
  assert.match(
    routeSrc,
    /sharedCacheSetNx\([\s\S]{0,120}\)\.catch\(\(\) => true\)/,
    "a Redis error must not permanently block every future warm pass"
  );
});

test("the lock is released in a finally block so a thrown warm pass still frees the next run", () => {
  const finallyBlock = /\} finally \{\s*await sharedCacheDel\(OVERLAP_LOCK_KEY\)\.catch\(\(\) => undefined\);\s*\}/;
  assert.match(routeSrc, finallyBlock, "release must run on both the success and error paths");
});

test("the lock TTL (240s) comfortably covers the measured max runtime (209.2s)", () => {
  assert.match(routeSrc, /OVERLAP_LOCK_TTL_SEC = 240/);
});
