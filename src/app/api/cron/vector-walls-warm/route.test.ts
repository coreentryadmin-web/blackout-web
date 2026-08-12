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
