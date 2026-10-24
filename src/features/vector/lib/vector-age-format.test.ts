import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  effectiveUniverseAsOf,
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

test("Vector universe consumers derive staleness from effectiveUniverseAsOf, not raw data.updatedAt (source scan)", () => {
  // BUG FIX (2026-09-14): `data.updatedAt` is bumped to Date.now() on EVERY snapshot write,
  // including a single-ticker append that refreshes exactly one row — see
  // effectiveUniverseAsOf's own doc comment for the live-measured evidence (updatedAt 2.1min
  // vs median row asOf 71.4min). This test previously asserted the OLD call pattern
  // (`isVectorUniverseSnapshotStale(data.updatedAt, now)`), which is exactly the bug; it now
  // asserts the corrected one while preserving the original intent — never gate staleness on
  // raw `now - data.updatedAt` subtraction.
  for (const rel of [
    "../components/VectorScanner.tsx",
    "../components/VectorTickerComparisonStrip.tsx",
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.match(
      src,
      /effectiveUniverseAsOf\(data\)/,
      `${rel} must derive freshness via effectiveUniverseAsOf(data), not raw data.updatedAt`
    );
    assert.match(
      src,
      /isVectorUniverseSnapshotStale\(effectiveAsOf, now\)/,
      `${rel} must gate staleness on the effective (median-row) asOf, not raw data.updatedAt`
    );
    assert.doesNotMatch(
      src,
      /isVectorUniverseSnapshotStale\(data\.updatedAt, now\)/,
      `${rel} must not gate staleness directly on raw data.updatedAt`
    );
    assert.doesNotMatch(
      src,
      /now\s*-\s*data\.updatedAt\s*>=\s*VECTOR_UNIVERSE_STALE_MS/,
      `${rel} must not gate staleness with raw subtraction`
    );
  }
});

test("effectiveUniverseAsOf: null/undefined snapshot → null", () => {
  assert.equal(effectiveUniverseAsOf(null), null);
  assert.equal(effectiveUniverseAsOf(undefined), null);
});

test("effectiveUniverseAsOf: odd row count → true median (middle element)", () => {
  const snapshot = {
    updatedAt: 100,
    rows: [{ asOf: 30 }, { asOf: 10 }, { asOf: 20 }],
  };
  // sorted: [10, 20, 30] -> middle index 1 -> 20
  assert.equal(effectiveUniverseAsOf(snapshot), 20);
});

test("effectiveUniverseAsOf: even row count → upper-middle element (Math.floor(len/2))", () => {
  const snapshot = {
    updatedAt: 100,
    rows: [{ asOf: 40 }, { asOf: 10 }, { asOf: 30 }, { asOf: 20 }],
  };
  // sorted: [10, 20, 30, 40] -> Math.floor(4/2)=2 -> 30
  assert.equal(effectiveUniverseAsOf(snapshot), 30);
});

test("effectiveUniverseAsOf: filters non-finite/non-positive asOf values before taking the median", () => {
  const snapshot = {
    updatedAt: 100,
    rows: [
      { asOf: 50 },
      { asOf: null },
      { asOf: undefined },
      { asOf: 0 },
      { asOf: -10 },
      { asOf: NaN },
      { asOf: 10 },
      { asOf: 30 },
    ],
  };
  // usable: [50, 10, 30] -> sorted [10, 30, 50] -> middle index 1 -> 30
  assert.equal(effectiveUniverseAsOf(snapshot), 30);
});

test("effectiveUniverseAsOf: a single freshly-appended row does not mask a stale roster", () => {
  const freshRow = { asOf: 999_000 };
  const staleRows = Array.from({ length: 9 }, () => ({ asOf: 100_000 }));
  const snapshot = { updatedAt: 999_000, rows: [freshRow, ...staleRows] };
  // median of one fresh + nine stale rows should land on the stale cluster, not the fresh outlier
  assert.equal(effectiveUniverseAsOf(snapshot), 100_000);
});

test("effectiveUniverseAsOf: no row carries a usable asOf → falls back to updatedAt", () => {
  const snapshot = {
    updatedAt: 555,
    rows: [{ asOf: null }, { asOf: 0 }, { asOf: NaN }],
  };
  assert.equal(effectiveUniverseAsOf(snapshot), 555);
});

test("effectiveUniverseAsOf: no usable row and a non-finite updatedAt → null (never fabricates)", () => {
  const snapshot = { updatedAt: NaN, rows: [{ asOf: null }] };
  assert.equal(effectiveUniverseAsOf(snapshot), null);
});

test("effectiveUniverseAsOf: empty rows array → falls back to updatedAt", () => {
  const snapshot = { updatedAt: 777, rows: [] };
  assert.equal(effectiveUniverseAsOf(snapshot), 777);
});
