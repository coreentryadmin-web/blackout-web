// Regression: vector-full-state-snapshot must handshake via after() so Cloudflare never 504s
// the cron before logCronRun fires (ops #1355 — same class as bie-full-state-snapshot #1343).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("vector-full-state-snapshot dispatches heavy sweep in after() and returns 202", () => {
  assert.match(routeSrc, /after\(dispatchSnapshot\)/, "must use after() for fire-and-forget handshake");
  assert.match(routeSrc, /status:\s*202/, "must return HTTP 202 accepted");
  assert.match(routeSrc, /logCronRun\("vector-full-state-snapshot"/, "must log cron handshake before response");
  assert.doesNotMatch(
    routeSrc,
    /await logCronRun\("vector-full-state-snapshot"[\s\S]*await runVectorFullStateSnapshot/,
    "logCronRun must not await the heavy sweep inline"
  );
});
