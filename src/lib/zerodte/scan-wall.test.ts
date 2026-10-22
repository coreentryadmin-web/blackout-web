import test from "node:test";
import assert from "node:assert/strict";
import { zerodteScanWallMs } from "./scan-wall-ms";

test("zerodteScanWallMs defaults under critical_stale (10m)", () => {
  const prev = process.env.ZERODTE_SCAN_WALL_MS;
  delete process.env.ZERODTE_SCAN_WALL_MS;
  assert.equal(zerodteScanWallMs(), 9 * 60 * 1000);
  process.env.ZERODTE_SCAN_WALL_MS = "120000";
  assert.equal(zerodteScanWallMs(), 120_000);
  if (prev === undefined) delete process.env.ZERODTE_SCAN_WALL_MS;
  else process.env.ZERODTE_SCAN_WALL_MS = prev;
});
