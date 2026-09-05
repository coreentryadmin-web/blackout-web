import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isVectorUniverseSnapshotStale,
  VECTOR_UNIVERSE_STALE_MS,
} from "./vector-age-format";

test("isVectorUniverseSnapshotStale: recent snapshot is not stale", () => {
  const now = 1_000_000;
  assert.equal(isVectorUniverseSnapshotStale(now - 60_000, now), false);
});

test("isVectorUniverseSnapshotStale: old snapshot is stale", () => {
  const now = 1_000_000;
  assert.equal(
    isVectorUniverseSnapshotStale(now - VECTOR_UNIVERSE_STALE_MS - 1, now),
    true
  );
});

test("isVectorUniverseSnapshotStale: far-future updatedAt is stale (fail closed)", () => {
  const now = 1_000_000;
  assert.equal(isVectorUniverseSnapshotStale(now + 60_000, now), true);
});

test("Vector universe consumers use isVectorUniverseSnapshotStale (source scan)", () => {
  for (const rel of [
    "../components/VectorScanner.tsx",
    "../components/VectorTickerComparisonStrip.tsx",
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.match(
      src,
      /isVectorUniverseSnapshotStale\(data\.updatedAt, now\)/,
      `${rel} must not use raw now-updatedAt staleness`
    );
    assert.doesNotMatch(
      src,
      /now\s*-\s*data\.updatedAt\s*>=\s*VECTOR_UNIVERSE_STALE_MS/,
      `${rel} must not gate staleness with raw subtraction`
    );
  }
});
