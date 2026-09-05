import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  formatVectorAge,
  isVectorUniverseSnapshotStale,
  VECTOR_UNIVERSE_STALE_MS,
} from "./vector-age-format";

test("formatVectorAge: null/undefined/zero/negative asOf or missing now → null (no chip)", () => {
  assert.equal(formatVectorAge(null, 1000), null);
  assert.equal(formatVectorAge(undefined, 1000), null);
  assert.equal(formatVectorAge(0, 1000), null);
  assert.equal(formatVectorAge(-5, 1000), null);
  assert.equal(formatVectorAge(500, null), null);
});

test("formatVectorAge: under a minute renders whole seconds", () => {
  assert.equal(formatVectorAge(1000, 1000), "0s");
  assert.equal(formatVectorAge(1000, 1500), "0s");
  assert.equal(formatVectorAge(1000, 6000), "5s");
  assert.equal(formatVectorAge(1000, 60_000 - 1), "58s");
});

test("formatVectorAge: a minute or more renders whole minutes", () => {
  assert.equal(formatVectorAge(1000, 1000 + 60_000), "1m");
  assert.equal(formatVectorAge(1000, 1000 + 90_000), "1m");
  assert.equal(formatVectorAge(1000, 1000 + 25 * 60_000), "25m");
});

test("formatVectorAge: asOf in the future clamps to 0s, never negative", () => {
  assert.equal(formatVectorAge(2000, 1000), "0s");
});

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
