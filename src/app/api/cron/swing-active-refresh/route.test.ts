// Regression: swing-active-refresh must handshake via after() so Cloudflare never 504s
// the cron before logCronRun fires (ops #1364 — same class as vector-universe-snapshot).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("swing-active-refresh dispatches refresh in after() and returns 202", () => {
  assert.match(routeSrc, /after\(dispatchRefresh\)/, "must use after() for fire-and-forget handshake");
  assert.match(routeSrc, /status:\s*202/, "must return HTTP 202 accepted");
  assert.match(routeSrc, /logCronRun\("swing-active-refresh"/, "must log cron handshake before response");
  assert.doesNotMatch(
    routeSrc,
    /await logCronRun\("swing-active-refresh"[\s\S]*await runSwingActiveRefresh\(/,
    "logCronRun must not await the heavy refresh inline"
  );
});

test("swing-active-refresh background dispatch is wrapped in runWithBackgroundUwSweep", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/
  );
  assert.match(routeSrc, /runWithBackgroundUwSweep\(\(\) => runSwingActiveRefreshCron\(started\)\)/);
});
