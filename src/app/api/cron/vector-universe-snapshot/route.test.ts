// Regression: vector-universe-snapshot must handshake via after() so Cloudflare never 504s
// the cron before logCronRun fires (ops #1360 — same class as vector-full-state-snapshot #1355).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("vector-universe-snapshot dispatches heavy sweep in after() and returns 202", () => {
  assert.match(routeSrc, /after\(dispatchSnapshot\)/, "must use after() for fire-and-forget handshake");
  assert.match(routeSrc, /status:\s*202/, "must return HTTP 202 accepted");
  assert.match(routeSrc, /logCronRun\("vector-universe-snapshot"/, "must log cron handshake before response");
  assert.doesNotMatch(
    routeSrc,
    /await logCronRun\("vector-universe-snapshot"[\s\S]*await runVectorUniverseSnapshot/,
    "logCronRun must not await the heavy sweep inline"
  );
});
