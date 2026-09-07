import { test } from "node:test";
import assert from "node:assert/strict";
import { gexMatrixRthAgeMin, gexMatrixStaleDuringRth } from "./data-integrity-gex-freshness";

test("gexMatrixRthAgeMin: ordinary past asof returns positive minutes", () => {
  const now = Date.parse("2026-09-07T15:00:00.000Z");
  const asof = "2026-09-07T14:50:00.000Z";
  assert.equal(gexMatrixRthAgeMin(asof, now), 10);
});

test("gexMatrixStaleDuringRth: within 15m band is not stale", () => {
  const now = Date.parse("2026-09-07T15:00:00.000Z");
  const asof = "2026-09-07T14:50:00.000Z";
  assert.equal(gexMatrixStaleDuringRth(asof, now), false);
});

test("gexMatrixStaleDuringRth: past 15m band is stale", () => {
  const now = Date.parse("2026-09-07T15:00:00.000Z");
  const asof = "2026-09-07T14:40:00.000Z";
  assert.equal(gexMatrixStaleDuringRth(asof, now), true);
});

test("gexMatrixStaleDuringRth: clock-skewed future asof is stale, not silently fresh", () => {
  const now = Date.parse("2026-09-07T15:00:00.000Z");
  const asof = "2026-09-07T15:10:00.000Z";
  assert.equal(gexMatrixRthAgeMin(asof, now), Infinity);
  assert.equal(gexMatrixStaleDuringRth(asof, now), true);
});

test("gexMatrixStaleDuringRth: unparseable asof is stale", () => {
  const now = Date.parse("2026-09-07T15:00:00.000Z");
  assert.equal(gexMatrixStaleDuringRth("not-a-date", now), true);
});
