// Regression guard: Vector live-data warmers must be in CRON_DISPATCH so the staleness
// watchdog's self-heal can re-trigger them during RTH (#1333 — same class as grid-warm).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const VECTOR_SELF_HEAL_CRONS = [
  "vector-universe-snapshot",
  "vector-full-state-snapshot",
  "vector-walls-warm",
  "vector-bead-record",
  "vector-dark-pool-warm",
];

const OPS_SELF_HEAL_CRONS = [
  "coaching-alerts",
  "bie-full-state-snapshot",
  "swing-active-refresh",
];

const dispatchSrc = readFileSync(join(ROOT, "src/lib/cron-dispatch.ts"), "utf8");

for (const key of [...VECTOR_SELF_HEAL_CRONS, ...OPS_SELF_HEAL_CRONS]) {
  test(`cron-dispatch includes safe Vector warmer "${key}"`, () => {
    assert.match(
      dispatchSrc,
      new RegExp(`"${key}":\\s*\\{`),
      `${key} must be in CRON_DISPATCH for watchdog self-heal`,
    );
  });
}
