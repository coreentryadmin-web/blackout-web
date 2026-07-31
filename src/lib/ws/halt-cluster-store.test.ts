import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeClusterHalts } from "./halt-cluster-store";

test("mergeClusterHalts: cluster entries visible when local stores are empty (web tier)", async () => {
  const { warmClusterHaltsFromRedis, persistClusterUwHalts } = await import("./halt-cluster-store");
  const now = Date.now();
  const halts = new Map([
    [
      "SPY",
      {
        symbol: "SPY",
        halt_type: "LUDP",
        reason: "test",
        halted_at: null,
        active: true,
        receivedAt: now,
      },
    ],
  ]);
  await persistClusterUwHalts(halts, now);
  await warmClusterHaltsFromRedis();
  const merged = mergeClusterHalts([], []);
  assert.ok(merged.some((h) => h.symbol === "SPY"), "cluster halt must surface with empty local stores");
});

test("mergeClusterHalts: local ingest entries override cluster on symbol collision", () => {
  const local = [
    { symbol: "NVDA", halt_type: "local", reason: "ingest", halted_at: null, active: true },
  ];
  const merged = mergeClusterHalts(local, []);
  assert.equal(merged.find((h) => h.symbol === "NVDA")?.halt_type, "local");
});
