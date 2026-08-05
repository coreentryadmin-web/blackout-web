import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("vector-bead-record cron dispatches recorder in after()", () => {
  const routeSrc = readFileSync("src/app/api/cron/vector-bead-record/route.ts", "utf8");
  assert.match(routeSrc, /recordSharedUniverseWallSamples/);
  assert.match(routeSrc, /after\(/);
  assert.match(routeSrc, /logCronRun\("vector-bead-record"/);
});

test("vector-bead-recorder-leader ticks every 5s during RTH", () => {
  const src = readFileSync("src/lib/vector-bead-recorder-leader.ts", "utf8");
  assert.match(src, /VECTOR_BEAD_RECORD_TICK_MS/);
  assert.match(readFileSync("src/features/vector/lib/vector-bead-recorder-logic.ts", "utf8"), /5_000/);
  assert.match(src, /recordSharedUniverseWallSamples/);
  assert.match(src, /isEtCashRth/);
});
