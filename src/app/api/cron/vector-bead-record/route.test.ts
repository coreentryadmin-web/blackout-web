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

test("vector-bead-recorder-leader logs cron_job_runs heartbeat for observability", () => {
  assert.match(leaderSrc, /logCronRun\("vector-bead-record"/);
  assert.match(leaderSrc, /HEARTBEAT_INTERVAL_MS/);
  assert.match(leaderSrc, /maybeLogLeaderHeartbeat/);
});

test("leader guards the active lane PER TICKER, not by dropping the whole lane", () => {
  // The universe sweep lost this guard in #2303; the viewer lane kept it. `activeRecordInFlight`
  // alone meant one slow viewer ticker cost EVERY other viewer their 15s sample — a bigger hole
  // per drop than the universe lane's 5s, on names no other lane records.
  assert.doesNotMatch(
    leaderSrc,
    /if\s*\(\s*activeRecordInFlight\s*\|\|/,
    "the whole-lane drop guard must not come back"
  );
  assert.match(leaderSrc, /MAX_CONCURRENT_ACTIVE_SWEEPS/, "overlap is bounded, not forbidden");
  assert.match(
    leaderSrc,
    /activeSweepBudget/,
    "the active lane reports its own overrun against its own 15s budget"
  );
  assert.match(
    leaderSrc,
    /activeTickerFailureStreaks/,
    "one viewer ticker going dark must be named, not hidden behind a whole-pass warning"
  );
});
