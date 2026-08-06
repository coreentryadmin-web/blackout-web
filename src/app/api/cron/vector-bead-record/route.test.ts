// Regression: vector-bead-record must handshake via after() so Cloudflare never 504s
// the cron before logCronRun fires (ops #1783 — same class as vector-full-state-snapshot #1355).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);
const leaderSrc = readFileSync("src/lib/vector-bead-recorder-leader.ts", "utf8");

test("vector-bead-record dispatches recorder in after() and returns 202", () => {
  assert.match(routeSrc, /recordSharedUniverseWallSamples/);
  assert.match(routeSrc, /recordActiveNonUniverseWallSamples/);
  assert.match(routeSrc, /after\(dispatchRecording\)/, "must use after() for fire-and-forget handshake");
  assert.match(routeSrc, /status:\s*202/, "must return HTTP 202 accepted");
  assert.match(routeSrc, /await logCronRun\("vector-bead-record"/, "must log cron handshake before response");
  assert.doesNotMatch(
    routeSrc,
    /await logCronRun\("vector-bead-record"[\s\S]*await recordSharedUniverseWallSamples/,
    "logCronRun must not await the heavy recording inline"
  );
});

test("vector-bead-recorder-leader ticks every 5s during RTH", () => {
  assert.match(leaderSrc, /VECTOR_BEAD_RECORD_TICK_MS/);
  assert.match(leaderSrc, /VECTOR_BEAD_RECORD_ACTIVE_TICK_MS/);
  assert.match(leaderSrc, /recordActiveNonUniverseWallSamples/);
  assert.match(leaderSrc, /isEtCashRth/);
});
